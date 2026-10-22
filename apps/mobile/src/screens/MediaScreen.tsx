import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { ChevronRight, File, FileText, Image as ImageIcon, TriangleAlert } from 'lucide-react-native';
import { formatBytes, toBase64, type MediaItem } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Header, errorText } from '../ui';
import { openAttachment } from './AttachmentView';
import { play } from '../voice';
import type { Route } from '../App';

const isMedia = (m: MediaItem) => m.kind === 'image';

function day(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Open a saved file in the full-screen viewer (decrypted into memory only). */
async function view(item: MediaItem, onError: (m: string) => void) {
  try {
    const a = await client.openMedia(item);
    if (a.kind === 'audio') return void play(a, () => {}).catch((e) => onError(errorText(e)));
    if (!openAttachment(a)) onError('This file type cannot be opened inside CellMate');
  } catch (e) {
    onError(errorText(e));
  }
}

/** Long-press: delete from this device (when the admin allows clearing history). */
function askDelete(item: MediaItem, onError: (m: string) => void) {
  if (!client.canClearHistory) return;
  Alert.alert('Delete file', `Delete ${item.name} from this device?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => void client.deleteMedia(item).catch((e) => onError(errorText(e))) },
  ]);
}

/** Saved photo, decrypted into memory while it is on screen. */
function Thumb({ item, size, onError }: { item: MediaItem; size: number; onError: (m: string) => void }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    client
      .openMedia(item)
      .then((a) => !gone && setUri(`data:${a.mime};base64,${toBase64(a.data!)}`))
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [item]);
  return (
    <Pressable
      onPress={() => void view(item, onError)}
      onLongPress={() => askDelete(item, onError)}
      style={[styles.thumb, { width: size, height: size }]}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : failed ? (
        <TriangleAlert size={18} color={colors.warn} />
      ) : (
        <ActivityIndicator size="small" color={colors.faint} />
      )}
    </Pressable>
  );
}

/** "Media and docs" row for the chat details screen, with a few recent photos under it. */
export function MediaSection({ chatKey, navigate, onError }: { chatKey: string; navigate: (r: Route) => void; onError: (m: string) => void }) {
  const c = useClient();
  const items = c.getMedia(chatKey);
  const photos = items.filter(isMedia).slice(0, 4);
  const { width } = useWindowDimensions();
  const size = Math.floor((width - 32 - 24 - 18) / 4);
  return (
    <View style={[s.card, { marginTop: 16 }]}>
      <Pressable
        onPress={() => navigate({ name: 'media', peer: chatKey })}
        style={({ pressed }) => [s.row, { padding: 14, gap: 8 }, pressed && { backgroundColor: colors.hover }]}
      >
        <Text style={[s.textStrong, { flex: 1 }]}>Media and docs</Text>
        <Text style={s.muted}>{items.length}</Text>
        <ChevronRight size={18} color={colors.faint} />
      </Pressable>
      {photos.length > 0 && (
        <View style={[s.row, { gap: 6, paddingHorizontal: 12, paddingBottom: 12 }]}>
          {photos.map((m) => (
            <Thumb key={m.msgId} item={m} size={size} onError={onError} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Every saved photo and document of a chat, like WhatsApp's "Media, links and docs". */
export function MediaScreen({ chatKey, navigate, onError }: { chatKey: string; navigate: (r: Route) => void; onError: (m: string) => void }) {
  const c = useClient();
  const [tab, setTab] = useState<'media' | 'docs'>('media');
  const { width } = useWindowDimensions();
  const items = c.getMedia(chatKey);
  const photos = items.filter(isMedia);
  const docs = items.filter((m) => !isMedia(m));
  const size = Math.floor((width - 8) / 3) - 4;

  return (
    <View style={s.fill}>
      <Header title={`${c.chatTitle(chatKey)} · Media`} onBack={() => navigate({ name: 'info', peer: chatKey })} />
      <View style={[s.row, styles.tabs]}>
        {(['media', 'docs'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={{ color: tab === t ? colors.accent : colors.muted, fontWeight: '600' }}>
              {t === 'media' ? `Media (${photos.length})` : `Docs (${docs.length})`}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === 'media' ? (
        <FlatList
          key="media"
          data={photos}
          numColumns={3}
          keyExtractor={(m) => m.msgId}
          contentContainerStyle={{ padding: 4, flexGrow: 1 }}
          ListEmptyComponent={<Empty icon={ImageIcon} text="No photos yet" />}
          renderItem={({ item }) => (
            <View style={{ padding: 2 }}>
              <Thumb item={item} size={size} onError={onError} />
            </View>
          )}
        />
      ) : (
        <FlatList
          key="docs"
          data={docs}
          keyExtractor={(m) => m.msgId}
          contentContainerStyle={{ padding: 12, gap: 8, flexGrow: 1 }}
          ListEmptyComponent={<Empty icon={FileText} text="No documents yet" />}
          renderItem={({ item }) => {
            const Icon = item.kind === 'pdf' ? FileText : File;
            const [bg, fg] = item.kind === 'pdf' ? ['#fef3f2', '#d92d20'] : [colors.accentSoft, colors.accent];
            return (
              <Pressable
                onPress={() => void view(item, onError)}
                onLongPress={() => askDelete(item, onError)}
                style={({ pressed }) => [s.card, s.row, { padding: 12, gap: 12 }, pressed && { backgroundColor: colors.hover }]}
              >
                <View style={[styles.docIcon, { backgroundColor: bg }]}>
                  <Icon size={20} color={fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.textStrong} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={[s.muted, { fontSize: 12 }]}>
                    {formatBytes(item.size)} · {item.outgoing ? 'You' : item.from} · {day(item.ts)}
                  </Text>
                  {!!item.caption && (
                    <Text style={[s.text, { fontSize: 13, color: colors.text2 }]} numberOfLines={2}>
                      {item.caption}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
      <Text style={[s.muted, { fontSize: 12, textAlign: 'center', padding: 12 }]}>
        Kept encrypted on this device.{c.canClearHistory ? ' Long-press a file to delete it.' : ''}
      </Text>
    </View>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof File; text: string }) {
  return (
    <View style={[s.center, { gap: 8 }]}>
      <Icon size={30} color={colors.faint} />
      <Text style={s.muted}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.hover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: { backgroundColor: colors.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineStrong },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.accent },
  docIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
