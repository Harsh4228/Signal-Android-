import { useEffect, useMemo, useState } from 'react';
import { BackHandler, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { File, FileText, Image as ImageIcon, Mic, Search, Send, Video, X } from 'lucide-react-native';
import { MAX_ATTACHMENT_BYTES, formatBytes } from '@meetme/core';
import { client, useClient } from '../messenger';
import { readUri } from '../files';
import type { SharedIn } from '../deviceFiles';
import { colors, s } from '../theme';
import { Button, ChatAvatar, IconButton, errorText } from '../ui';

const iconFor = (mime: string) =>
  mime.startsWith('image/') ? ImageIcon : mime.startsWith('video/') ? Video : mime.startsWith('audio/') ? Mic : mime === 'application/pdf' ? FileText : File;

/**
 * Something was shared to CellMate from another app (WhatsApp, the gallery, Files...): choose the chats and send it,
 * end-to-end encrypted like anything else. Follows the admin's "Send photos & files" right and group sender rules.
 */
export function ShareInScreen({ shared, onClose, onSent, onToast }: { shared: SharedIn; onClose: () => void; onSent: (chat: string) => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState(shared.text);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const files = shared.files;
  const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
  const q = query.trim().toLowerCase();
  const keys = useMemo(
    () =>
      c
        .orderedChats()
        .filter((k) => c.canSendTo(k) && (!files.length || c.can('sendFiles', k)))
        .filter((k) => !q || c.chatTitle(k).toLowerCase().includes(q)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, files.length, q],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (onClose(), true));
    return () => sub.remove();
  }, [onClose]);

  async function send() {
    setBusy(true);
    try {
      const ok = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
      const data = await Promise.all(ok.map(async (f) => ({ name: f.name, mime: f.mime || 'application/octet-stream', data: await readUri(f.uri) })));
      const message = text.trim();
      let failed = 0;
      for (const key of picked) {
        try {
          // The message goes with the first file as its caption, or on its own.
          for (let i = 0; i < data.length; i++) await client.sendFile(key, data[i]!, i === 0 ? message : '');
          if (!data.length && message) await client.sendText(key, message);
        } catch {
          failed++;
        }
      }
      onToast(failed ? `Sent to ${picked.length - failed}; ${failed} failed` : `Sent to ${picked.length} chat${picked.length === 1 ? '' : 's'}`);
      if (picked.length === 1 && !failed) onSent(picked[0]!);
      else onClose();
    } catch (e) {
      onToast(errorText(e));
      setBusy(false);
    }
  }

  const nothing = !files.length && !text.trim();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <IconButton icon={X} label="Cancel" onPress={onClose} />
        <Send size={20} color={colors.accent} />
        <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>
          Send to…
        </Text>
      </View>
      <View style={{ paddingHorizontal: 12, paddingTop: 8, gap: 6 }}>
        {files.slice(0, 5).map((f, i) => {
          const Icon = iconFor(f.mime);
          return (
            <View key={i} style={[s.row, { gap: 10 }]}>
              <Icon size={18} color={colors.accent} />
              <Text style={[s.text, { flex: 1 }]} numberOfLines={1}>
                {f.name}
              </Text>
              {f.size >= 0 && <Text style={[s.muted, { fontSize: 12 }, f.size > MAX_ATTACHMENT_BYTES && { color: colors.danger }]}>{formatBytes(f.size)}</Text>}
            </View>
          );
        })}
        {files.length > 5 && <Text style={s.muted}>and {files.length - 5} more</Text>}
        {!!tooBig.length && (
          <Text style={{ color: colors.danger, fontSize: 12 }}>
            {tooBig.length} file{tooBig.length === 1 ? ' is' : 's are'} over {MAX_ATTACHMENT_BYTES / 1024 / 1024} MB and won't be sent
          </Text>
        )}
        <TextInput
          style={[s.input, { maxHeight: 110 }]}
          value={text}
          onChangeText={setText}
          placeholder={files.length ? 'Add a message (optional)' : 'Message'}
          placeholderTextColor={colors.faint}
          multiline
        />
        <View style={[s.row, s.input, { gap: 8, paddingVertical: 0 }]}>
          <Search size={16} color={colors.faint} />
          <TextInput style={{ flex: 1, color: colors.text, paddingVertical: 10 }} value={query} onChangeText={setQuery} placeholder="Search chats" placeholderTextColor={colors.faint} />
        </View>
      </View>
      <FlatList
        data={keys}
        keyExtractor={(k) => k}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={[s.muted, { padding: 16, textAlign: 'center' }]}>No chats you can send this to.</Text>}
        renderItem={({ item }) => {
          const on = picked.includes(item);
          return (
            <Pressable
              style={({ pressed }) => [s.row, { gap: 12, padding: 12 }, pressed && { backgroundColor: colors.hover }]}
              onPress={() => setPicked((p) => (on ? p.filter((x) => x !== item) : [...p, item]))}
            >
              <View style={[styles.box, on && { backgroundColor: colors.accent, borderColor: colors.accent }]} />
              <ChatAvatar chatKey={item} size={40} />
              <Text style={[s.textStrong, { flex: 1 }]} numberOfLines={1}>
                {c.chatTitle(item)}
              </Text>
            </Pressable>
          );
        }}
      />
      <View style={{ padding: 12 }}>
        <Button
          variant="primary"
          icon={Send}
          title={`Send${picked.length > 1 ? ` to ${picked.length} chats` : ''}`}
          busy={busy}
          disabled={!picked.length || nothing || (files.length > 0 && tooBig.length === files.length)}
          onPress={() => void send()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.lineStrong },
});
