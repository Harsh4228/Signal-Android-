import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { File, FileText, Film, Image as ImageIcon, Mic, Trash2, type LucideIcon } from 'lucide-react-native';
import { formatBytes, type MediaItem } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { ChatAvatar, Header, IconButton, errorText, useBack } from '../ui';
import { openAttachment } from './AttachmentView';

const ICON: Record<MediaItem['kind'], LucideIcon> = { image: ImageIcon, video: Film, pdf: FileText, audio: Mic, file: File };

/**
 * "Manage storage", like WhatsApp: how much this phone keeps for each chat and the biggest files. Deleting follows
 * the admin's rule for clearing history (the same as deleting one file in Media and docs).
 */
export function StorageScreen({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  useBack(onClose);
  const u = c.storageUsage();

  const remove = (m: MediaItem) =>
    Alert.alert('Delete file', `Delete ${m.name} (${formatBytes(m.size)}) from this phone?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void client.deleteMedia(m).catch((e) => onToast(errorText(e))) },
    ]);
  const open = (m: MediaItem) =>
    void client
      .openMedia(m)
      .then((a) => !openAttachment(a) && onToast('This file type cannot be opened inside CellMate'))
      .catch((e) => onToast(errorText(e)));

  return (
    <View style={[s.fill, { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.bg }]}>
      <Header title="Storage" onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
        <View style={[s.card, { padding: 16, gap: 4 }]}>
          <Text style={[s.textStrong, { fontSize: 22 }]}>{formatBytes(u.total)}</Text>
          <Text style={s.muted}>Photos, videos and files kept encrypted on this phone. Messages themselves take very little.</Text>
        </View>

        {u.largest.length > 0 && <Text style={s.section}>Larger than 1 MB</Text>}
        {u.largest.length > 0 && (
          <View style={[s.card, { paddingVertical: 4 }]}>
            {u.largest.map((m, i) => {
              const Icon = ICON[m.kind] ?? File;
              return (
                <View key={`${m.chat}-${m.msgId}`}>
                  {i > 0 && <View style={[s.divider, { marginLeft: 56 }]} />}
                  <Pressable onPress={() => open(m)} style={({ pressed }) => [s.row, { gap: 12, padding: 12 }, pressed && { backgroundColor: colors.hover }]}>
                    <Icon size={22} color={colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.textStrong} numberOfLines={1}>
                        {m.name}
                      </Text>
                      <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={1}>
                        {formatBytes(m.size)} · {c.chatTitle(m.chat)}
                      </Text>
                    </View>
                    {c.canClearHistory && <IconButton icon={Trash2} label="Delete from this phone" color={colors.danger} onPress={() => remove(m)} />}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        <Text style={s.section}>Chats</Text>
        <View style={[s.card, { paddingVertical: 4 }]}>
          {!u.chats.length && <Text style={[s.muted, { padding: 14 }]}>Nothing saved yet.</Text>}
          {u.chats.map((x, i) => (
            <View key={x.chat}>
              {i > 0 && <View style={[s.divider, { marginLeft: 64 }]} />}
              <View style={[s.row, { gap: 12, padding: 12 }]}>
                <ChatAvatar chatKey={x.chat} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={s.textStrong} numberOfLines={1}>
                    {c.chatTitle(x.chat)}
                  </Text>
                  <Text style={[s.muted, { fontSize: 12 }]}>
                    {x.count} file{x.count === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text style={s.textStrong}>{formatBytes(x.bytes)}</Text>
              </View>
            </View>
          ))}
        </View>
        {!c.canClearHistory && <Text style={[s.muted, { fontSize: 12, textAlign: 'center' }]}>Your admin has turned off deleting files.</Text>}
      </ScrollView>
    </View>
  );
}
