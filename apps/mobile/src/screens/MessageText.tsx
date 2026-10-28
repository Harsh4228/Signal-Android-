import { Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Eye, EyeOff, Image as ImageIcon, X } from 'lucide-react-native';
import { LINK_RE, shortId, toBase64, type ChatMessage } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { useBack } from '../ui';

/** Ask first: a link in a message could lead anywhere. */
function openLink(url: string) {
  Alert.alert('Open link?', url, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Open', onPress: () => void Linking.openURL(url) },
  ]);
}

/** Message text with tappable links and highlighted @mentions. */
export function MessageText({ m }: { m: ChatMessage }) {
  const tokens: string[] = [];
  for (const u of m.mentions ?? []) {
    tokens.push(`@${shortId(u)}`);
    const name = client.displayName(u);
    if (name) tokens.push(`@${name}`);
  }
  const mention = tokens.length ? new RegExp(`(${tokens.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi') : null;
  const parts: { text: string; link?: boolean; mention?: boolean }[] = [];
  let last = 0;
  for (const match of m.text.matchAll(LINK_RE)) {
    if (match.index! > last) parts.push({ text: m.text.slice(last, match.index) });
    parts.push({ text: match[0], link: true });
    last = match.index! + match[0].length;
  }
  if (last < m.text.length) parts.push({ text: m.text.slice(last) });
  return (
    <Text style={[s.text, { lineHeight: 21 }]} selectable={false}>
      {parts.map((p, i) =>
        p.link ? (
          <Text key={i} style={{ color: colors.accent, textDecorationLine: 'underline' }} onPress={() => openLink(p.text)}>
            {p.text}
          </Text>
        ) : mention ? (
          p.text.split(mention).map((piece, j) =>
            j % 2 ? (
              <Text key={`${i}-${j}`} style={{ color: colors.accent, fontWeight: '600' }}>
                {piece}
              </Text>
            ) : (
              piece
            ),
          )
        ) : (
          p.text
        ),
      )}
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
        <Image source={{ uri: `data:${a.mime};base64,${toBase64(a.data)}` }} style={{ flex: 1 }} resizeMode="contain" />
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
  vo: { gap: 10, paddingVertical: 6, paddingRight: 8 },
  close: { position: 'absolute', top: 12, left: 12, padding: 10 },
  hint: { position: 'absolute', bottom: 28, alignSelf: 'center', color: '#ddd', fontSize: 13 },
});
