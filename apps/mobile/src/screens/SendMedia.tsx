import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Eye, File, Film, Pencil, SendHorizontal, Smile, Trash2, X } from 'lucide-react-native';
import { formatBytes, toBase64, type OutgoingFile } from '@meetme/core';
import { client } from '../messenger';
import { colors } from '../theme';
import { IconButton, errorText, useBack } from '../ui';
import { PhotoEditor } from './PhotoEditor';
import { makeSticker } from '../mediaWorker';

export type Prepared = { file: OutgoingFile; caption: string };

/**
 * Before sending photos / videos / files, like WhatsApp: look at each one, give each its own caption, edit photos
 * (crop, rotate, draw, text), drop any, then send them (each as its own message). Drawn inside the app window
 * (not a separate window), so screenshot protection still covers it.
 */
export function SendMediaScreen({
  files,
  firstCaption,
  viewOnce,
  onSend,
  onClose,
  onToast,
}: {
  files: OutgoingFile[];
  firstCaption: string;
  viewOnce?: boolean;
  onSend: (items: Prepared[]) => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [items, setItems] = useState<Prepared[]>(() => files.map((file, i) => ({ file, caption: i === 0 ? firstCaption : '' })));
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useBack(editing ? null : onClose);
  const cur = items[Math.min(index, items.length - 1)];
  const uri = useMemo(() => (cur && cur.file.mime.startsWith('image/') ? `data:${cur.file.mime};base64,${toBase64(cur.file.data)}` : null), [cur?.file]);
  if (!cur) return null;
  const update = (patch: Partial<Prepared>) => setItems((list) => list.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  const isPhoto = cur.file.mime.startsWith('image/') && !/gif/i.test(cur.file.mime);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0b0f17' }]}>
      <View style={styles.bar}>
        <IconButton icon={X} label="Cancel" color="#fff" onPress={onClose} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {viewOnce && <Eye size={14} color="#fff" />}
          <Text style={{ color: '#fff', fontSize: 13 }} numberOfLines={1}>
            {viewOnce ? 'View once · ' : ''}
            {formatBytes(cur.file.data.length)}
          </Text>
        </View>
        {isPhoto && !viewOnce && (
          <IconButton
            icon={Smile}
            label="Keep as a sticker"
            color="#fff"
            onPress={() =>
              void makeSticker(cur.file)
                .then((st) => client.addSticker(st))
                .then(() => onToast('Added to your stickers'), (e) => onToast(errorText(e)))
            }
          />
        )}
        {isPhoto && <IconButton icon={Pencil} label="Edit: crop, rotate, draw, text" color="#fff" onPress={() => setEditing(true)} />}
        {items.length > 1 && (
          <IconButton
            icon={Trash2}
            label="Don't send this one"
            color="#fff"
            onPress={() => {
              setItems((list) => list.filter((_, i) => i !== index));
              setIndex((i) => Math.max(0, Math.min(i, items.length - 2)));
            }}
          />
        )}
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        ) : (
          <View style={{ alignItems: 'center', gap: 8 }}>
            {cur.file.mime.startsWith('video/') ? <Film size={48} color="#cbd5e1" /> : <File size={48} color="#cbd5e1" />}
            <Text style={{ color: '#e5e7eb' }} numberOfLines={2}>
              {cur.file.name}
            </Text>
          </View>
        )}
      </View>
      {items.length > 1 && (
        <FlatList
          horizontal
          data={items}
          keyExtractor={(_, i) => String(i)}
          style={{ flexGrow: 0 }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 10, paddingVertical: 6 }}
          renderItem={({ item, index: i }) => (
            <Pressable onPress={() => setIndex(i)} style={[styles.thumb, i === index && { borderColor: colors.accent }]}>
              {item.file.mime.startsWith('image/') ? (
                <Image source={{ uri: `data:${item.file.mime};base64,${toBase64(item.file.data)}` }} style={{ width: '100%', height: '100%' }} />
              ) : item.file.mime.startsWith('video/') ? (
                <Film size={20} color="#cbd5e1" />
              ) : (
                <File size={20} color="#cbd5e1" />
              )}
            </Pressable>
          )}
        />
      )}
      <View style={styles.captionRow}>
        <TextInput
          value={cur.caption}
          onChangeText={(t) => update({ caption: t })}
          placeholder="Add a caption…"
          placeholderTextColor="rgba(255,255,255,0.6)"
          maxLength={4000}
          multiline
          style={styles.caption}
        />
        <Pressable
          style={[styles.send, busy && { opacity: 0.5 }]}
          disabled={busy}
          accessibilityLabel={`Send ${items.length}`}
          onPress={() => {
            setBusy(true);
            onSend(items);
          }}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <SendHorizontal size={20} color="#fff" />}
          {items.length > 1 && <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{items.length}</Text>}
        </Pressable>
      </View>
      {editing && (
        <PhotoEditor
          file={cur.file}
          onCancel={() => setEditing(false)}
          onDone={(f) => {
            update({ file: f });
            setEditing(false);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8 },
  thumb: { width: 52, height: 52, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center' },
  captionRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10 },
  caption: { flex: 1, color: '#fff', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  send: { minWidth: 48, height: 48, borderRadius: 24, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 2, paddingHorizontal: 12 },
});
