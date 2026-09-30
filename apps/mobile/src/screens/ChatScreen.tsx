import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  BadgeCheck,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  File,
  FileText,
  Image,
  Lock,
  Megaphone,
  Paperclip,
  Phone,
  SendHorizontal,
  ShieldAlert,
  Timer,
  Video,
} from 'lucide-react-native';
import type { ChatMessage } from '@meetme/core';
import { pickFile, type PickKind } from '../files';
import { AttachmentView } from './AttachmentView';
import { calls, client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, Header, IconButton, Sheet, clock, errorText } from '../ui';
import type { Route } from '../App';

function Tick({ status }: { status: NonNullable<ChatMessage['status']> }) {
  const Icon =
    status === 'sending' ? Clock3 : status === 'sent' ? Check : status === 'failed' ? CircleAlert : CheckCheck;
  const color = status === 'read' ? colors.accent : status === 'failed' ? colors.danger : colors.faint;
  return <Icon size={14} color={color} strokeWidth={2.2} />;
}

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
  const [attachOpen, setAttachOpen] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const messages = c.getMessages(peer);
  const timer = c.getDisappearingTimer(peer);
  const online = c.status === 'online';

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
      onError(errorText(e));
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
      onError(errorText(e));
    }
  }

  const call = (video: boolean) => calls.startCall(peer, video).catch((e) => onError(errorText(e)));
  const canSend = !!text.trim() && online;

  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header
        onBack={() => navigate({ name: 'list' })}
        title={
          <Pressable style={[s.row, { gap: 10 }]} onPress={() => navigate({ name: 'info', peer })}>
            <Avatar name={peer} size={38} />
            <View style={{ flex: 1 }}>
              <View style={[s.row, { gap: 5 }]}>
                <Text style={[s.textStrong, { fontSize: 16, flexShrink: 1 }]} numberOfLines={1}>
                  {peer}
                </Text>
                {verified && <BadgeCheck size={15} color={colors.ok} />}
              </View>
              <View style={[s.row, { gap: 4 }]}>
                <Lock size={11} color={colors.muted} />
                <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={1}>
                  {timer ? 'Encrypted · disappearing' : 'End-to-end encrypted'}
                </Text>
              </View>
            </View>
          </Pressable>
        }
        right={
          <>
            <IconButton icon={Phone} label="Voice call" disabled={!online} onPress={() => call(false)} />
            <IconButton icon={Video} label="Video call" disabled={!online} onPress={() => call(true)} />
          </>
        }
      />

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 12, gap: 6 }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item: m }) =>
          m.system ? (
            <View style={styles.system}>
              <ShieldAlert size={13} color={colors.muted} />
              <Text style={[s.muted, { fontSize: 12, flexShrink: 1, textAlign: 'center' }]}>{m.text}</Text>
            </View>
          ) : (
            <View style={[styles.bubble, m.outgoing ? styles.out : styles.in, m.broadcast && styles.announce]}>
              {m.broadcast && (
                <View style={[s.row, { gap: 5, marginBottom: 4 }]}>
                  <Megaphone size={13} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '700' }}>Announcement</Text>
                </View>
              )}
              {m.attachment && <AttachmentView a={m.attachment} />}
              {/* selectable={false}: message text cannot be copied */}
              {!!m.text && (
                <Text style={[s.text, { lineHeight: 21 }]} selectable={false}>
                  {m.text}
                </Text>
              )}
              <View style={[s.row, { gap: 4, alignSelf: 'flex-end', marginTop: 2 }]}>
                {!!m.expiresAt && <Timer size={11} color={colors.faint} />}
                <Text style={{ color: colors.faint, fontSize: 11 }}>{clock(m.ts)}</Text>
                {m.outgoing && m.status && <Tick status={m.status} />}
              </View>
            </View>
          )
        }
      />

      <View style={styles.composer}>
        <View style={styles.field}>
          <IconButton icon={Paperclip} label="Attach" disabled={!online} color={colors.muted} onPress={() => setAttachOpen(true)} />
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={online ? 'Write a message…' : 'Offline - reconnecting…'}
            placeholderTextColor={colors.faint}
            multiline
            // Keep the keyboard from learning / suggesting what you type.
            autoCorrect={false}
            spellCheck={false}
            keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
            importantForAutofill="no"
          />
        </View>
        <Pressable
          style={[styles.send, !canSend && { opacity: 0.4 }]}
          disabled={!canSend}
          onPress={send}
          accessibilityLabel="Send"
        >
          <SendHorizontal size={20} color="#fff" strokeWidth={2} />
        </Pressable>
      </View>

      {attachOpen && (
        <Sheet
          title="Send securely"
          onClose={() => setAttachOpen(false)}
          actions={[
            { icon: Image, label: 'Photo', onPress: () => void sendPicked('photo') },
            { icon: FileText, label: 'PDF document', onPress: () => void sendPicked('pdf') },
            { icon: File, label: 'Other file', onPress: () => void sendPicked('file') },
          ]}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  out: {
    alignSelf: 'flex-end',
    backgroundColor: colors.out,
    borderColor: colors.outBorder,
    borderBottomRightRadius: 4,
  },
  in: {
    alignSelf: 'flex-start',
    backgroundColor: colors.in,
    borderColor: colors.line,
    borderBottomLeftRadius: 4,
  },
  announce: { borderLeftWidth: 3, borderLeftColor: colors.accent },
  system: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    maxWidth: '88%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginVertical: 8,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 8,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineStrong,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.bg,
    borderRadius: 22,
    paddingRight: 12,
    minHeight: 44,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15.5,
    maxHeight: 120,
    paddingTop: Platform.OS === 'ios' ? 12 : 10,
    paddingBottom: Platform.OS === 'ios' ? 12 : 10,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
