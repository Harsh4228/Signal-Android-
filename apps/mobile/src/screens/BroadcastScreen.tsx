import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { formatBytes, type OutgoingFile } from '@meetme/core';
import { client } from '../messenger';
import { pickFile, type PickKind } from '../files';
import { colors, s } from '../theme';
import type { Route } from '../App';

export function BroadcastScreen({ navigate, onDone }: { navigate: (r: Route) => void; onDone: (m: string) => void }) {
  const [text, setText] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<OutgoingFile | null>(null);

  const choose = () =>
    Alert.alert('Attach', undefined, [
      { text: '🖼 Photo', onPress: () => void load('photo') },
      { text: '📄 PDF', onPress: () => void load('pdf') },
      { text: '📎 File', onPress: () => void load('file') },
    ]);
  async function load(kind: PickKind) {
    try {
      const f = await pickFile(kind);
      if (f) setFile(f);
    } catch (e) {
      onDone(e instanceof Error ? e.message : String(e));
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
      onDone(r.failed.length ? `Sent to ${r.sent}. Failed: ${r.failed.join(', ')}` : `📢 Sent to ${r.sent} employees`);
      navigate({ name: 'list' });
    } catch (e) {
      onDone(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || (!text.trim() && !file) || !count;

  return (
    <View style={s.fill}>
      <View style={s.header}>
        <Pressable style={s.iconBtn} onPress={() => navigate({ name: 'list' })}>
          <Text style={s.icon}>‹</Text>
        </Pressable>
        <Text style={[s.text, { fontWeight: '700', fontSize: 17 }]}>📢 Announcement</Text>
      </View>
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={s.muted}>
          {count === null ? 'Loading employees…' : `Goes to ${count} employees.`} Each copy is end-to-end encrypted
          separately. Replies come back to you as private chats.
        </Text>
        <TextInput
          style={[s.input, { minHeight: 140, textAlignVertical: 'top' }]}
          value={text}
          onChangeText={setText}
          placeholder="Type the announcement…"
          placeholderTextColor={colors.muted}
          multiline
          autoFocus
        />
        <View style={[s.row, { gap: 8 }]}>
          <Pressable style={[s.button, { flex: 1, marginTop: 0 }]} onPress={choose}>
            <Text style={s.buttonText} numberOfLines={1}>
              📎 {file ? `${file.name} (${formatBytes(file.data.length)})` : 'Attach photo / PDF / file'}
            </Text>
          </Pressable>
          {file && (
            <Pressable style={[s.button, { marginTop: 0 }]} onPress={() => setFile(null)}>
              <Text style={s.buttonText}>✕</Text>
            </Pressable>
          )}
        </View>
        <Pressable style={[s.button, s.primary, disabled && { opacity: 0.5 }]} disabled={disabled} onPress={send}>
          <Text style={s.buttonText}>{busy ? 'Sending…' : 'Send to everyone'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
