import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { pickFile, type PickKind } from '../files';
import { AttachmentView } from './AttachmentView';
import type { ChatMessage } from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { colors, s } from '../theme';
import type { Route } from '../App';

const time = (ts: number) => {
  const d = new Date(ts);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const TICKS: Record<NonNullable<ChatMessage['status']>, string> = {
  sending: '🕓',
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
  failed: '⚠',
};

export function ChatScreen({
  peer,
  navigate,
  onError,
}: {
  peer: string;
  navigate: (r: Route) => void;
  onError: (m: string) => void;
}) {
  const c = useClient();
  const [text, setText] = useState('');
  const [verified, setVerified] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messages = c.getMessages(peer);
  const timer = c.getDisappearingTimer(peer);

  useEffect(() => {
    void client.getSafetyNumber(peer).then((sn) => setVerified(!!sn?.verified));
  }, [peer, messages.length]);

  async function send() {
    const t = text;
    if (!t.trim()) return;
    setText('');
    try {
      await client.sendText(peer, t);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function sendPicked(kind: PickKind) {
    try {
      const file = await pickFile(kind);
      if (!file) return;
      const caption = text;
      setText('');
      await client.sendFile(peer, file, caption);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  const attach = () =>
    Alert.alert('Send', 'Choose what to send (end-to-end encrypted)', [
      { text: '🖼 Photo', onPress: () => void sendPicked('photo') },
      { text: '📄 PDF', onPress: () => void sendPicked('pdf') },
      { text: '📎 File', onPress: () => void sendPicked('file') },
    ], { cancelable: true });

  const call = (video: boolean) =>
    calls.startCall(peer, video).catch((e) => onError(e instanceof Error ? e.message : String(e)));

  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <Pressable style={s.iconBtn} onPress={() => navigate({ name: 'list' })}>
          <Text style={s.icon}>‹</Text>
        </Pressable>
        <Pressable style={[s.row, { flex: 1, gap: 10 }]} onPress={() => navigate({ name: 'info', peer })}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{peer[0]!.toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.text, { fontWeight: '700' }]}>
              {peer} {verified && <Text style={{ color: colors.ok, fontSize: 12 }}>✔</Text>}
            </Text>
            <Text style={s.muted}>🔒 encrypted{timer ? ' · ⏱' : ''}</Text>
          </View>
        </Pressable>
        <Pressable style={s.iconBtn} onPress={() => call(false)}>
          <Text style={s.icon}>📞</Text>
        </Pressable>
        <Pressable style={s.iconBtn} onPress={() => call(true)}>
          <Text style={s.icon}>🎥</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 10, gap: 4 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item: m }) =>
          m.system ? (
            <Text
              style={[
                s.muted,
                {
                  alignSelf: 'center',
                  textAlign: 'center',
                  backgroundColor: colors.panel,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  marginVertical: 6,
                  fontSize: 12,
                },
              ]}
            >
              {m.text}
            </Text>
          ) : (
            <View
              style={{
                alignSelf: m.outgoing ? 'flex-end' : 'flex-start',
                backgroundColor: m.outgoing ? colors.out : colors.in,
                borderRadius: 12,
                paddingHorizontal: 10,
                paddingTop: 6,
                paddingBottom: 4,
                maxWidth: '80%',
                borderLeftWidth: m.broadcast ? 3 : 0,
                borderLeftColor: '#f5a524',
              }}
            >
              {m.broadcast && (
                <Text style={{ color: '#f5a524', fontSize: 11, fontWeight: '700' }}>📢 Announcement</Text>
              )}
              {m.attachment && <AttachmentView a={m.attachment} />}
              {/* selectable={false}: message text cannot be copied */}
              {!!m.text && (
                <Text style={s.text} selectable={false}>
                  {m.text}
                </Text>
              )}
              <Text style={{ color: 'rgba(233,237,239,0.65)', fontSize: 11, alignSelf: 'flex-end' }}>
                {m.expiresAt ? '⏱ ' : ''}
                {time(m.ts)}
                {m.outgoing && m.status ? (
                  <Text style={{ color: m.status === 'read' ? '#7dd3fc' : undefined }}> {TICKS[m.status]}</Text>
                ) : null}
              </Text>
            </View>
          )
        }
      />

      <View style={[s.row, { padding: 8, gap: 8, backgroundColor: colors.panel }]}>
        <Pressable style={s.iconBtn} onPress={attach} disabled={c.status !== 'online'}>
          <Text style={[s.icon, c.status !== 'online' && { opacity: 0.4 }]}>📎</Text>
        </Pressable>
        <TextInput
          style={[s.input, { flex: 1, maxHeight: 120 }]}
          value={text}
          onChangeText={setText}
          placeholder={c.status === 'online' ? 'Message' : 'Offline - reconnecting…'}
          placeholderTextColor={colors.muted}
          multiline
          // Keep the keyboard from learning / suggesting what you type.
          autoCorrect={false}
          spellCheck={false}
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
          importantForAutofill="no"
          contextMenuHidden={false}
        />
        <Pressable
          style={[
            s.avatar,
            { backgroundColor: colors.accent },
            (!text.trim() || c.status !== 'online') && { opacity: 0.5 },
          ]}
          disabled={!text.trim() || c.status !== 'online'}
          onPress={send}
        >
          <Text style={s.icon}>➤</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
