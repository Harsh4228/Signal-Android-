import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Eraser } from 'lucide-react-native';
import { CLEAR_AGES, CLEAR_KINDS, type ClearKind } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Button, Header, errorText } from '../ui';

/**
 * Admin: clear chat history of a person (all their chats) or of a group (on every member's device), by age and kind.
 * Messages are end-to-end encrypted and only on the devices, so each app removes them when it is next online.
 */
export function ClearHistorySheet({
  scope,
  target,
  label,
  onClose,
  onToast,
}: {
  scope: 'user' | 'group';
  target: string;
  label: string;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [days, setDays] = useState(30);
  const [kinds, setKinds] = useState<Set<ClearKind>>(new Set(CLEAR_KINDS.map(([k]) => k)));
  const [busy, setBusy] = useState(false);
  const all = kinds.size === CLEAR_KINDS.length;
  const toggle = (k: ClearKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setKinds(next);
  };
  const ageText = CLEAR_AGES.find(([d]) => d === days)?.[1].toLowerCase() ?? '';
  const what = all ? 'all messages, files and calls' : CLEAR_KINDS.filter(([k]) => kinds.has(k)).map(([, l]) => l.split(' (')[0]!.toLowerCase()).join(', ');
  const where = scope === 'user' ? `in all of ${label}'s chats, on their devices` : `in the group "${label}", on every member's device`;

  const run = async () => {
    setBusy(true);
    try {
      await client.adminClearHistory({ scope, target, olderThanDays: days, kinds: [...kinds] });
      onToast(scope === 'user' ? `Clearing ${label}'s history when their devices are online` : `Clearing "${label}" on each member's device`);
      onClose();
    } catch (e) {
      onToast(errorText(e));
      setBusy(false);
    }
  };
  const confirm = () =>
    Alert.alert('Clear history', `Clear ${what} (${ageText}) ${where}?\n\nThis can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void run() },
    ]);

  const Box = ({ on, text, bold, onPress }: { on: boolean; text: string; bold?: boolean; onPress: () => void }) => (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, { gap: 12, paddingVertical: 11, paddingHorizontal: 12 }, pressed && { backgroundColor: colors.hover }]}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: on ? colors.accent : colors.lineStrong,
          backgroundColor: on ? colors.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on && <Check size={15} color="#fff" strokeWidth={3} />}
      </View>
      <Text style={[s.text, { flex: 1 }, bold && { fontWeight: '700' }]}>{text}</Text>
    </Pressable>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={[s.fill, { backgroundColor: colors.bg, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Header title="Clear history" subtitle={label} onBack={onClose} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
          <Text style={[s.muted, { fontSize: 13, lineHeight: 19 }]}>
            {scope === 'user'
              ? `Clears ${label}'s chats (1-to-1 and the groups they are in) on their own devices. Others keep their copies.`
              : 'Clears this group chat on the phones of everyone in it.'}{' '}
            Messages are end-to-end encrypted, so each app removes them the next time it is online.
          </Text>

          <Text style={s.section}>Which messages</Text>
          <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
            {CLEAR_AGES.map(([d, l]) => (
              <Pressable
                key={d}
                onPress={() => setDays(d)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: days === d ? colors.accent : colors.line,
                  backgroundColor: days === d ? colors.accentSoft : 'transparent',
                }}
              >
                <Text style={{ color: days === d ? colors.accentText : colors.text2, fontWeight: '600', fontSize: 13 }}>{l}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.section}>What to clear</Text>
          <View style={[s.card, { paddingVertical: 4 }]}>
            <Box on={all} bold text="Everything" onPress={() => setKinds(all ? new Set() : new Set(CLEAR_KINDS.map(([k]) => k)))} />
            {CLEAR_KINDS.map(([k, l]) => (
              <Box key={k} on={kinds.has(k)} text={l} onPress={() => toggle(k)} />
            ))}
          </View>

          <Button variant="danger" icon={Eraser} title="Clear" busy={busy} disabled={!kinds.size} onPress={confirm} />
        </ScrollView>
      </View>
    </Modal>
  );
}
