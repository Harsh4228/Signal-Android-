import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Plus, Smile } from 'lucide-react-native';
import { toBase64, type OutgoingFile } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Header, errorText, useBack } from '../ui';
import { pickFile } from '../files';
import { makeSticker } from '../mediaWorker';

/** My stickers: tap to send, + to make one from a photo, long-press to remove. Kept encrypted on this phone. */
export function StickerSheet({ onPick, onClose, onToast }: { onPick: (s: OutgoingFile) => void; onClose: () => void; onToast: (m: string) => void }) {
  useBack(onClose);
  const [list, setList] = useState<{ id: string; mime: string; data: Uint8Array }[] | null>(null);
  const load = () => void client.myStickers().then(setList, (e) => onToast(errorText(e)));
  useEffect(load, []);

  async function add() {
    try {
      const f = await pickFile('photo');
      if (!f) return;
      await client.addSticker(await makeSticker(f));
      load();
    } catch (e) {
      onToast(errorText(e));
    }
  }

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <Header title="Stickers" onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Pressable onPress={() => void add()} style={styles.cell} accessibilityLabel="Make a sticker from a photo">
          <Plus size={28} color={colors.muted} />
        </Pressable>
        {list?.map((st) => (
          <Pressable
            key={st.id}
            style={styles.cell}
            onPress={() => onPick({ name: 'sticker', mime: st.mime, data: st.data })}
            onLongPress={() =>
              Alert.alert('Remove sticker', 'Remove this sticker?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => void client.removeSticker(st.id).then(load) },
              ])
            }
          >
            <Image source={{ uri: `data:${st.mime};base64,${toBase64(st.data)}` }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          </Pressable>
        ))}
        {list && !list.length && (
          <View style={{ width: '100%', alignItems: 'center', gap: 6, padding: 16 }}>
            <Smile size={28} color={colors.faint} />
            <Text style={[s.muted, { textAlign: 'center' }]}>No stickers yet. Make one from a photo with +, or long-press a sticker you got.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { width: 80, height: 80, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', padding: 4 },
});
