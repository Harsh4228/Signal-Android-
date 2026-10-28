import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, Pencil, Plus, Trash2, UsersRound } from 'lucide-react-native';
import { MAX_GROUP_NAME, type Community, type GroupInfo } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Banner, Button, Field, IconButton, errorText, useBack } from '../ui';

type Draft = Omit<Community, 'id'> & { id?: string };

/** Company admin: communities (groups and channels put together, e.g. per office or project). */
export function CommunitiesTab({ groups, onToast }: { groups: GroupInfo[] | null; onToast: (m: string) => void }) {
  const [list, setList] = useState<Community[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  useEffect(() => {
    client.listCommunities().then(setList, (e) => onToast(errorText(e)));
  }, [onToast]);
  async function save(next: Draft[], msg: string) {
    try {
      setList(await client.setCommunities(next));
      setEditing(null);
      onToast(msg);
    } catch (e) {
      onToast(errorText(e));
    }
  }
  const nameOf = (id: string) => groups?.find((g) => g.id === id)?.name ?? 'Deleted group';
  if (editing) return <CommunityEditor draft={editing} groups={groups ?? []} onCancel={() => setEditing(null)} onSave={(d) => void save(d.id ? (list ?? []).map((c) => (c.id === d.id ? d : c)) : [...(list ?? []), d], `Saved "${d.name}"`)} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}>
      <Banner kind="ok" icon={UsersRound}>
        Put groups and channels together, e.g. one community per office or project. Everyone sees the communities under Channels &
        communities.
      </Banner>
      {list === null && <Text style={s.muted}>Loading…</Text>}
      {list?.map((c) => (
        <View key={c.id} style={[s.card, s.row, { padding: 12, gap: 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.textStrong}>{c.name}</Text>
            <Text style={s.muted} numberOfLines={2}>
              {c.groups.map(nameOf).join(', ') || 'No groups yet'}
            </Text>
          </View>
          <IconButton icon={Pencil} label="Edit" onPress={() => setEditing(c)} />
          <IconButton icon={Trash2} label="Delete" color={colors.danger} onPress={() => void save((list ?? []).filter((x) => x.id !== c.id), `Deleted "${c.name}"`)} />
        </View>
      ))}
      <Button variant="primary" title="New community" icon={Plus} onPress={() => setEditing({ name: '', description: '', groups: [] })} />
    </ScrollView>
  );
}

function CommunityEditor({ draft, groups, onCancel, onSave }: { draft: Draft; groups: GroupInfo[]; onCancel: () => void; onSave: (d: Draft) => void }) {
  useBack(onCancel);
  const [d, setD] = useState(draft);
  const toggle = (id: string) => setD((x) => ({ ...x, groups: x.groups.includes(id) ? x.groups.filter((g) => g !== id) : [...x.groups, id] }));
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>{draft.id ? 'Edit community' : 'New community'}</Text>
      <Field label="Name" value={d.name} onChangeText={(name) => setD({ ...d, name })} placeholder="e.g. Pune office" maxLength={MAX_GROUP_NAME} autoCapitalize="words" />
      <Field label="Description" value={d.description} onChangeText={(description) => setD({ ...d, description })} placeholder="What it is for" maxLength={300} autoCapitalize="sentences" />
      <Text style={s.label}>Groups and channels in it</Text>
      <View style={[s.card, { overflow: 'hidden' }]}>
        {groups.map((g, i) => (
          <Pressable key={g.id} onPress={() => toggle(g.id)} style={[styles.row, i > 0 && styles.line]}>
            <Text style={[s.text, { flex: 1 }]}>
              {g.name}
              {g.kind === 'channel' ? ' (channel)' : ''}
            </Text>
            {d.groups.includes(g.id) && <Check size={18} color={colors.accent} />}
          </Pressable>
        ))}
        {!groups.length && <Text style={[s.muted, { padding: 12 }]}>Create groups first.</Text>}
      </View>
      <View style={[s.row, { gap: 10 }]}>
        <Button title="Cancel" onPress={onCancel} style={{ flex: 1 }} />
        <Button variant="primary" title="Save" disabled={!d.name.trim()} onPress={() => onSave(d)} style={{ flex: 1 }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
});