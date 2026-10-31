import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Building2, Check, Search, Trash2, X } from 'lucide-react-native';
import { isGroupKey, type ChatList, type UserProfile } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Button, ChatAvatar, IconButton, errorText } from '../ui';

/**
 * Make or change one of my lists, like WhatsApp's lists: a name, and any people, groups, channels and whole
 * departments (everyone in them, also people who join later). It becomes a chip above the chats.
 */
export function ChatListEditor({ list, onClose, onToast }: { list?: ChatList; onClose: (saved?: ChatList) => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [name, setName] = useState(list?.name ?? '');
  const [chats, setChats] = useState<string[]>(list?.chats ?? []);
  const [departments, setDepartments] = useState<string[]>(list?.departments ?? []);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [tab, setTab] = useState<'people' | 'groups' | 'departments'>('people');
  const [query, setQuery] = useState('');
  useEffect(() => {
    client.listDirectory().then(setPeople, () => setPeople([]));
  }, []);
  const q = query.trim().toLowerCase();
  const match = (t: string) => !q || t.toLowerCase().includes(q);
  const groups = c.chatKeys().filter((k) => isGroupKey(k) && match(c.chatTitle(k)));
  const persons = people.filter((p) => match(`${p.name} ${p.username} ${p.departments.join(' ')}`));
  const allDepartments = [...new Set(people.flatMap((p) => p.departments))].sort().filter(match);
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const count = chats.length + departments.length;

  async function save() {
    try {
      const saved = await client.saveChatList({ id: list?.id, name, chats, departments });
      onToast(`List "${saved.name}" saved`);
      onClose(saved);
    } catch (e) {
      onToast(errorText(e));
    }
  }

  const row = (key: string, title: string, sub: string, on: boolean, flip: () => void, dept?: boolean) => (
    <Pressable key={key} onPress={flip} style={({ pressed }) => [s.row, styles.row, pressed && { backgroundColor: colors.hover }]}>
      {dept ? (
        <View style={styles.deptIcon}>
          <Building2 size={18} color={colors.accent} />
        </View>
      ) : (
        <ChatAvatar chatKey={key} size={40} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.textStrong} numberOfLines={1}>
          {title}
        </Text>
        {!!sub && <Text style={s.muted}>{sub}</Text>}
      </View>
      <View style={[styles.tick, on && styles.tickOn]}>{on && <Check size={14} color="#fff" />}</View>
    </Pressable>
  );

  return (
    <Modal animationType="slide" onRequestClose={() => onClose()}>
      <View style={[s.fill, { backgroundColor: colors.surface }]}>
        <View style={[s.row, { padding: 8, gap: 4 }]}>
          <IconButton icon={X} label="Close" onPress={() => onClose()} />
          <Text style={[s.title, { flex: 1 }]}>{list ? 'Edit list' : 'New list'}</Text>
          <Button variant="primary" title="Save" disabled={!name.trim() || !count} onPress={() => void save()} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <TextInput
            style={s.input}
            value={name}
            maxLength={40}
            onChangeText={setName}
            placeholder="List name, e.g. Sales, Managers"
            placeholderTextColor={colors.faint}
            autoFocus
          />
          <Text style={s.muted}>Pick people, groups or whole departments ({count} chosen). A department brings everyone in it.</Text>
          <View style={[s.row, { gap: 8 }]}>
            {(
              [
                ['people', 'People'],
                ['groups', 'Groups'],
                ['departments', 'Departments'],
              ] as const
            ).map(([id, label]) => (
              <Pressable key={id} onPress={() => setTab(id)} style={[styles.chip, tab === id && styles.chipOn]}>
                <Text style={[styles.chipText, tab === id && { color: colors.accentText }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[s.row, styles.search]}>
            <Search size={17} color={colors.faint} />
            <TextInput style={{ flex: 1, color: colors.text, paddingVertical: 9 }} value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.faint} />
          </View>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {tab === 'people' &&
            persons.map((p) =>
              row(p.username, p.name || client.displayName(p.username), p.departments.join(', '), chats.includes(p.username), () => toggle(chats, setChats, p.username)),
            )}
          {tab === 'groups' && groups.map((k) => row(k, c.chatTitle(k), c.isChannel(k) ? 'Channel' : 'Group', chats.includes(k), () => toggle(chats, setChats, k)))}
          {tab === 'departments' &&
            allDepartments.map((d) =>
              row(`d:${d}`, d, `${people.filter((p) => p.departments.includes(d)).length} people`, departments.includes(d), () => toggle(departments, setDepartments, d), true),
            )}
          {list && (
            <Pressable
              style={[s.row, { gap: 10, padding: 16, marginTop: 12 }]}
              onPress={() => void client.deleteChatList(list.id).then(() => onClose())}
            >
              <Trash2 size={18} color={colors.danger} />
              <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete this list (the chats stay)</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  deptIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  tick: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: colors.bg },
  chipOn: { backgroundColor: colors.accentSoft },
  chipText: { color: colors.text2, fontSize: 13.5, fontWeight: '600' },
  search: { gap: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.bg },
});
