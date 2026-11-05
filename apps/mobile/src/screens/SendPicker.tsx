import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Search, X, type LucideIcon } from 'lucide-react-native';
import { isGroupKey, type UserProfile } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Button, ChatAvatar, IconButton } from '../ui';

/**
 * "Send to…" / "Forward to…": pick one or more chats. My chats come first, then everyone else in the company
 * (search finds any colleague by name, ID, department or employee ID, also people I never chatted with).
 */
export function SendPicker({
  title,
  icon,
  files,
  submit,
  top,
  disabled,
  onSend,
  onClose,
}: {
  title: string;
  icon: LucideIcon;
  /** Sending files: only chats where the admin allows files. */
  files: boolean;
  /** The button text for n chosen chats. */
  submit: (n: number) => string;
  /** Shown above the search (what is being sent, a message box…). */
  top?: ReactNode;
  disabled?: boolean;
  /** Chats I never had are started first (ensureChat); report the result yourself. */
  onSend: (keys: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const c = useClient();
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    client.listDirectory().then(setPeople, () => setPeople([]));
  }, []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (onClose(), true));
    return () => sub.remove();
  }, [onClose]);
  const keys = c.sendTargets(people, query, files);
  const chats = new Set(c.chatKeys());
  const Icon = icon;

  async function send() {
    setBusy(true);
    try {
      for (const k of picked) await client.ensureChat(k).catch(() => {});
      await onSend(picked);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <IconButton icon={X} label="Close" onPress={onClose} />
        <Icon size={20} color={colors.accent} />
        <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {top && <View style={{ paddingHorizontal: 12, paddingTop: 8, gap: 6 }}>{top}</View>}
      <View style={[s.row, s.input, { gap: 8, paddingVertical: 0, marginHorizontal: 12, marginTop: 8 }]}>
        <Search size={16} color={colors.faint} />
        <TextInput
          style={{ flex: 1, color: colors.text, paddingVertical: 10 }}
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, ID or department"
          placeholderTextColor={colors.faint}
          autoCorrect={false}
        />
      </View>
      <FlatList
        data={keys}
        keyExtractor={(k) => k}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={[s.muted, { padding: 16, textAlign: 'center' }]}>{query ? 'Nobody matches.' : 'No chats yet.'}</Text>}
        renderItem={({ item, index }) => {
          const on = picked.includes(item);
          const fresh = !chats.has(item) && !isGroupKey(item);
          const firstFresh = fresh && (index === 0 || chats.has(keys[index - 1]!));
          const depts = fresh ? c.profileOf(item)?.departments.join(', ') : '';
          return (
            <>
              {firstFresh && <Text style={[s.section, { marginHorizontal: 12 }]}>Other people</Text>}
              <Pressable
                style={({ pressed }) => [s.row, { gap: 12, paddingHorizontal: 12, paddingVertical: 10 }, pressed && { backgroundColor: colors.hover }]}
                onPress={() => setPicked((p) => (on ? p.filter((x) => x !== item) : [...p, item]))}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
              >
                <View style={[styles.box, on && { backgroundColor: colors.accent, borderColor: colors.accent }]} />
                <ChatAvatar chatKey={item} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={s.textStrong} numberOfLines={1}>
                    {c.chatTitle(item)}
                  </Text>
                  {!!depts && (
                    <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={1}>
                      {depts}
                    </Text>
                  )}
                </View>
              </Pressable>
            </>
          );
        }}
      />
      <View style={{ padding: 12 }}>
        <Button variant="primary" icon={icon} title={submit(picked.length)} busy={busy} disabled={!picked.length || disabled} onPress={() => void send()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.lineStrong },
});
