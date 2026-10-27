import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { CircleAlert, RefreshCw, Search } from 'lucide-react-native';
import { shortId, type UserProfile } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, Banner, Header, IconButton, errorText } from '../ui';
import type { Route } from '../App';

const NO_DEPT = 'No department';

/** Colleagues grouped by department (someone in two departments shows in both), A-Z, filtered by name / ID / department. */
function sections(users: UserProfile[], q: string) {
  const match = (u: UserProfile) =>
    !q || (u.name || '').toLowerCase().includes(q) || shortId(u.username).includes(q) || u.departments.some((d) => d.toLowerCase().includes(q));
  const byDept = new Map<string, UserProfile[]>();
  for (const u of users.filter(match)) {
    for (const d of u.departments.length ? u.departments : [NO_DEPT]) {
      if (!byDept.has(d)) byDept.set(d, []);
      byDept.get(d)!.push(u);
    }
  }
  return [...byDept.entries()]
    .sort(([a], [b]) => (a === NO_DEPT ? 1 : b === NO_DEPT ? -1 : a.localeCompare(b)))
    .map(([title, data]) => ({ title, data }));
}

/**
 * Everyone in the company you can message, by department, like WhatsApp's "New chat" contact list.
 * `embedded` shows it without its own header (inside the empty chat list on first login).
 */
export function DirectoryList({ onOpen, embedded }: { onOpen: (username: string) => void; embedded?: boolean }) {
  const [users, setUsers] = useState<UserProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const load = useCallback(() => {
    setError(null);
    client.listDirectory().then(setUsers, (e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);
  const q = query.trim().toLowerCase();
  const data = useMemo(() => sections(users ?? [], q), [users, q]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.search}>
        <Search size={18} color={colors.faint} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, ID or department"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      {error && (
        <View style={{ paddingHorizontal: 12, gap: 8 }}>
          <Banner kind="error" icon={CircleAlert}>
            {error}
          </Banner>
          <IconButton icon={RefreshCw} label="Try again" onPress={load} />
        </View>
      )}
      {!users && !error ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
      ) : (
        <SectionList
          sections={data}
          keyExtractor={(u, i) => `${u.username}:${i}`}
          stickySectionHeadersEnabled
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
          ListHeaderComponent={
            embedded && users?.length ? <Text style={[s.muted, { paddingHorizontal: 16, paddingBottom: 4 }]}>Your colleagues: tap someone to start a chat.</Text> : undefined
          }
          ListEmptyComponent={
            <View style={[s.center, { paddingTop: 32 }]}>
              <Text style={s.muted}>{q ? 'Nobody matches' : 'No colleagues have joined yet'}</Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHead}>
              {section.title} · {section.data.length}
            </Text>
          )}
          renderItem={({ item: u }) => (
            <Pressable onPress={() => onOpen(u.username)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}>
              <Avatar name={u.username} size={44} />
              <View style={styles.itemBody}>
                <Text style={[s.textStrong, { fontSize: 16 }]} numberOfLines={1}>
                  {u.name || shortId(u.username)}
                </Text>
                <Text style={[s.muted, { marginTop: 2 }]} numberOfLines={1}>
                  {[shortId(u.username), ...u.departments].join(' · ')}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

export async function openDirectChat(username: string, navigate: (r: Route) => void, onError: (m: string) => void) {
  try {
    await client.addContact(username);
    navigate({ name: 'chat', peer: username });
  } catch (e) {
    onError(errorText(e));
  }
}

export function DirectoryScreen({ navigate, onError }: { navigate: (r: Route) => void; onError: (m: string) => void }) {
  return (
    <View style={s.screen}>
      <Header title="New chat" onBack={() => navigate({ name: 'list' })} />
      <DirectoryList onOpen={(u) => void openDirectChat(u, navigate, onError)} />
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.bg,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11 },
  sectionHead: {
    backgroundColor: colors.surface,
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 16 },
  itemBody: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
});
