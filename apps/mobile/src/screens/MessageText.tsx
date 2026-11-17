import { Alert, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ZoomImage } from '../ZoomImage';
import { Eye, EyeOff, Image as ImageIcon, X } from 'lucide-react-native';
import { FONT_SIZES, formatText, mentionPattern, shortId, toBase64, type ChatMessage, type TextSpan } from '@meetme/core';
import { client, groupCalls } from '../messenger';
import { colors, s } from '../theme';
import { useBack } from '../ui';
import { MediaPlayer } from './VideoView';

/** Ask first: a link in a message could lead anywhere. */
function openLink(url: string) {
  // CellMate's own call / group invite links open inside the app.
  const app = client.parseAppLink(url);
  if (app) return void openAppLink(app.kind, app.group);
  Alert.alert('Open link?', url, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open', onPress: () => void Linking.openURL(url) },
  ]);
}

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/** Message text: *bold*, _italic_, ~strike~, `code`, quotes and lists (like WhatsApp), tappable links, @mentions. */
export function MessageText({ m }: { m: ChatMessage }) {
  const tokens: string[] = [];
  for (const u of m.mentions ?? []) {
    tokens.push(`@${shortId(u)}`);
    const name = client.displayName(u);
    if (name) tokens.push(`@${name}`);
  }
  const lines = formatText(m.text, mentionPattern(tokens));
  const scale = FONT_SIZES[client.appearance.fontSize] ?? 1;
  const size = { fontSize: 15 * scale, lineHeight: 21 * scale };
  return (
    <View>
      {lines.map((l, i) => (
        <View key={i} style={[l.quote && styles.quote, l.mono && styles.monoLine, !!l.bullet && { flexDirection: 'row', gap: 6 }]}>
          {!!l.bullet && <Text style={[s.text, size, { color: colors.muted }]}>{l.bullet}</Text>}
          <Text style={[s.text, size, { flexShrink: 1 }, l.quote && { color: colors.muted }]} selectable={false}>
            {l.spans.length ? l.spans.map((sp, j) => <Span key={j} s={sp} />) : ' '}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Span({ s: sp }: { s: TextSpan }) {
  if (sp.link) {
    return (
      <Text style={{ color: colors.accent, textDecorationLine: 'underline' }} onPress={() => openLink(sp.text)}>
        {sp.text}
      </Text>
    );
  }
  if (sp.mention) return <Text style={{ color: colors.accent, fontWeight: '600' }}>{sp.text}</Text>;
  if (!sp.bold && !sp.italic && !sp.strike && !sp.code) return <>{sp.text}</>;
  return (
    <Text
      style={[
        sp.bold && { fontWeight: '700' },
        sp.italic && { fontStyle: 'italic' },
        sp.strike && { textDecorationLine: 'line-through' },
        sp.code && { fontFamily: mono, fontSize: 14, backgroundColor: colors.hover },
      ]}
    >
      {sp.text}
    </Text>
  );
}

/** A view-once photo in the chat: "Tap to view" once, then "Opened". */
export function ViewOnceBubble({ m, onOpen }: { m: ChatMessage; onOpen: () => void }) {
  const ready = !m.outgoing && !m.opened && !!m.attachment?.data;
  return (
    <Pressable disabled={!ready} onPress={onOpen} style={[s.row, styles.vo]}>
      {m.opened ? <EyeOff size={20} color={colors.muted} /> : <Eye size={20} color={colors.accent} />}
      <View>
        <Text style={s.textStrong}>{m.attachment?.mime.startsWith('video/') ? 'Video' : 'Photo'} · view once</Text>
        <Text style={s.muted}>
          {m.outgoing ? (m.opened ? 'Opened' : 'Not opened yet') : m.opened ? 'Opened' : ready ? 'Tap to view' : 'Loading…'}
        </Text>
      </View>
    </Pressable>
  );
}

/** Full screen, once: closing it removes the photo for good. */
export function ViewOnceViewer({ m, onClose }: { m: ChatMessage; onClose: () => void }) {
  const a = client.viewOnceFile(m);
  const close = () => {
    client.closeViewOnce(m);
    onClose();
  };
  useBack(close);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
      {a?.data && a.kind === 'image' ? (
        <ZoomImage uri={`data:${a.mime};base64,${toBase64(a.data)}`} />
      ) : a?.data && a.kind === 'video' ? (
        <View style={{ flex: 1, paddingTop: 60, paddingBottom: 60 }}>
          <MediaPlayer a={a} />
        </View>
      ) : (
        <View style={[s.center]}>
          <ImageIcon size={40} color="#888" />
          <Text style={{ color: '#ccc', marginTop: 8 }}>This view-once file can't be shown here.</Text>
        </View>
      )}
      <Pressable onPress={close} accessibilityLabel="Close" style={styles.close}>
        <X size={26} color="#fff" />
      </Pressable>
      <Text style={styles.hint}>View once: it is gone when you close it</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  quote: { borderLeftWidth: 3, borderLeftColor: colors.lineStrong, paddingLeft: 8 },
  monoLine: { backgroundColor: colors.hover, paddingHorizontal: 6 },
  vo: { gap: 10, paddingVertical: 6, paddingRight: 8 },
  close: { position: 'absolute', top: 12, left: 12, padding: 10 },
  hint: { position: 'absolute', bottom: 28, alignSelf: 'center', color: '#ddd', fontSize: 13 },
});

/** A call link joins (or starts) the group's call; an invite link opens the group or asks to join it. */
function openAppLink(kind: 'call' | 'group', group: string) {
  const fail = (e: unknown) => Alert.alert('CellMate', String((e as Error)?.message ?? e));
  if (!client.groupOf(group)) {
    if (kind === 'call') return Alert.alert('Call link', "You are not in this group, so you can't join its call.");
    return Alert.alert('Join group?', 'Ask to join this group? An admin approves your request.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Ask to join',
        onPress: () => void client.requestToJoin(group).then(() => Alert.alert('Request sent', 'You will see the group when an admin adds you.'), fail),
      },
    ]);
  }
  if (kind === 'group') return Alert.alert('Group link', `You are already in ${client.chatTitle(group)}.`);
  if (groupCalls.ongoingIn(group)) return void groupCalls.joinOngoing(group).catch(fail);
  Alert.alert('Start the call?', 'Nobody is in this call yet.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Start', onPress: () => void groupCalls.start(group, false).catch(fail) },
  ]);
}
