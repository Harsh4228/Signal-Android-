import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { File, FileText, Image, Megaphone, Paperclip, Send, X } from 'lucide-react-native';
import { formatBytes, type OutgoingFile } from '@meetme/core';
import { client } from '../messenger';
import { pickFile, type PickKind } from '../files';
import { colors, s } from '../theme';
import { Button, Header, IconButton, Sheet, errorText } from '../ui';
import type { Route } from '../App';

export function BroadcastScreen({ navigate, onDone }: { navigate: (r: Route) => void; onDone: (m: string) => void }) {
  const [text, setText] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<OutgoingFile | null>(null);
  const [choosing, setChoosing] = useState(false);

  async function load(kind: PickKind) {
    try {
      const f = await pickFile(kind);
      if (f) setFile(f);
    } catch (e) {
      onDone(errorText(e));
    }
  }

  useEffect(() => {
    client
      .listActiveRecipients()
      .then((u) => setCount(u.length))
      .catch(() => setCount(null));
  }, []);

  async function send() {
    setBusy(true);
    try {
      const r = await client.broadcast(text, file ?? undefined);
      onDone(r.failed.length ? `Sent to ${r.sent}. Failed: ${r.failed.join(', ')}` : `Announcement sent to ${r.sent} employees`);
      navigate({ name: 'list' });
    } catch (e) {
      onDone(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = (!text.trim() && !file) || !count;

  return (
    <View style={s.fill}>
      <Header title="New announcement" onBack={() => navigate({ name: 'list' })} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={[s.card, s.row, { padding: 14, gap: 12, alignItems: 'flex-start' }]}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Megaphone size={18} color={colors.accent} />
          </View>
          <Text style={[s.muted, { flex: 1, lineHeight: 19 }]}>
            {count === null ? 'Loading employees…' : `Goes to ${count} employees.`} Each copy is end-to-end encrypted
            separately. Replies come back to you as private chats.
          </Text>
        </View>
        <TextInput
          style={[s.input, { minHeight: 160, textAlignVertical: 'top', lineHeight: 21 }]}
          value={text}
          onChangeText={setText}
          placeholder="Write your announcement…"
          placeholderTextColor={colors.faint}
          multiline
          autoFocus
        />
        <View style={[s.row, { gap: 8 }]}>
          <Pressable
            onPress={() => setChoosing(true)}
            style={({ pressed }) => [
              s.row,
              {
                flex: 1,
                gap: 10,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: colors.lineStrong,
                borderRadius: 12,
                paddingHorizontal: 14,
                minHeight: 48,
                backgroundColor: colors.surface,
              },
              pressed && { backgroundColor: colors.hover },
            ]}
          >
            <Paperclip size={18} color={colors.muted} />
            <Text style={[s.text, { flex: 1, color: colors.text2 }]} numberOfLines={1}>
              {file ? `${file.name} (${formatBytes(file.data.length)})` : 'Attach photo, PDF or file'}
            </Text>
          </Pressable>
          {file && <IconButton icon={X} label="Remove file" onPress={() => setFile(null)} />}
        </View>
        <Button variant="primary" icon={Send} title="Send to everyone" busy={busy} disabled={disabled} onPress={send} />
      </ScrollView>

      {choosing && (
        <Sheet
          title="Attach"
          onClose={() => setChoosing(false)}
          actions={[
            { icon: Image, label: 'Photo', onPress: () => void load('photo') },
            { icon: FileText, label: 'PDF document', onPress: () => void load('pdf') },
            { icon: File, label: 'Other file', onPress: () => void load('file') },
          ]}
        />
      )}
    </View>
  );
}
