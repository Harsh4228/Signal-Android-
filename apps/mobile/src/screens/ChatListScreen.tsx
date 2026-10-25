import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ban, Bell, CircleDashed, EllipsisVertical, Megaphone, ShoppingBag, Star, MessageSquarePlus, Search, Settings, ShieldCheck, UserPlus } from 'lucide-react-native';
import { MessengerClient, isGroupKey } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, Banner, ChatAvatar, Header, IconButton, Logo, Sheet, errorText, shortTime, typingText } from '../ui';
import type { Route } from '../App';

export function ChatListScreen({ navigate, onError }: { navigate: (r: Route) => void; onError: (m: string) => void }) {
  const c = useClient();
  const [adding, setAdding] = useState('');
  const [filter, setFilter] = useState('');
  const [more, setMore] = useState(false);

  const [matches, setMatches] = useState<string[]>([]);

  // Suggest usernames as you type (debounced so each keystroke isn't a request).
  useEffect(() => {
    const q = adding.trim().toLowerCase();
    if (!q) {
      setMatches([]);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      client
        .searchUsers(q)
        .then((users) => !stale && setMatches(users))
        .catch(() => !stale && setMatches([]));
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [adding]);

  async function add(picked?: string) {
    const name = (picked ?? adding).trim().toLowerCase();
    if (!name) return;
    try {
      await client.addContact(name);
      setAdding('');
      setMatches([]);
      navigate({ name: 'chat', peer: name });
    } catch (e) {
      onError(errorText(e));
    }
  }

  const q = filter.trim().toLowerCase();
  const all = c.chatKeys();
  const sorted = all
    .filter((k) => !q || c.chatTitle(k).toLowerCase().includes(q))
    .sort((a, b) => (c.lastMessage(b)?.ts ?? 0) - (c.lastMessage(a)?.ts ?? 0));
  const online = c.status === 'online';
  const statusColor = c.banned ? colors.danger : online ? colors.online : c.status === 'connecting' ? '#f79009' : colors.danger;

  return (
    <View style={s.screen}>
      <Header
        left={
          <View style={{ paddingLeft: 8 }}>
            <Logo size={32} />
          </View>
        }
        title={
          <View>
            <Text style={[s.title, { fontSize: 19, fontWeight: '700' }]}>CellMate</Text>
            <View style={[s.row, { gap: 5 }]}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
              <Text style={[s.muted, { fontSize: 12, textTransform: 'capitalize' }]}>
                {c.account!.username} · {c.banned ? 'suspended' : c.status}
              </Text>
            </View>
          </View>
        }
        right={
          <>
            <View>
              <IconButton icon={CircleDashed} label="Status" onPress={() => navigate({ name: 'status' })} />
              {c.unseenStatusCount > 0 && (
                <View
                  pointerEvents="none"
                  style={{ position: 'absolute', top: 8, right: 8, width: 9, height: 9, borderRadius: 5, backgroundColor: colors.ok, borderWidth: 2, borderColor: colors.surface }}
                />
              )}
            </View>
            <IconButton icon={Bell} label="Notices" onPress={() => navigate({ name: 'notices' })} />
            {/* Everything else lives in the ⋮ menu, like WhatsApp. */}
            <IconButton icon={EllipsisVertical} label="Menu" onPress={() => setMore(true)} />
          </>
        }
      />

      {c.banned && (
        <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
          <Banner kind="error" icon={Ban}>
            Your account is suspended by the admin. You can't send or receive messages.
          </Banner>
        </View>
      )}

      <View style={styles.search}>
        <UserPlus size={18} color={colors.faint} />
        <TextInput
          style={styles.searchInput}
          value={adding}
          onChangeText={setAdding}
          placeholder="Start a chat by username"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => add()}
          returnKeyType="go"
        />
      </View>
      {matches.length > 0 && (
        <View style={styles.suggest}>
          {matches.map((u) => (
            <Pressable
              key={u}
              onPress={() => add(u)}
              style={({ pressed }) => [styles.suggestItem, pressed && { backgroundColor: colors.bg }]}
            >
              <Avatar name={u} size={32} />
              <Text style={{ color: colors.text, fontSize: 15 }}>{client.displayName(u)}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {all.length > 6 && (
        <View style={[styles.search, { marginTop: 0 }]}>
          <Search size={18} color={colors.faint} />
          <TextInput
            style={styles.searchInput}
            value={filter}
            onChangeText={setFilter}
            placeholder="Search chats"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      )}

      <FlatList
        data={sorted}
        keyExtractor={(n) => n}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={[s.center, { gap: 8 }]}>
            <View style={styles.emptyIcon}>
              <MessageSquarePlus size={28} color={colors.accent} />
            </View>
            <Text style={s.title}>{q ? 'No chats match' : 'No conversations yet'}</Text>
            {!q && <Text style={[s.muted, { textAlign: 'center' }]}>Type a username above to start a secure chat.</Text>}
          </View>
        }
        renderItem={({ item: key }) => {
          const last = c.lastMessage(key);
          const unread = c.getUnread(key);
          const group = isGroupKey(key);
          const typing = typingText(c.getTyping(key), group);
          const who = last ? (last.outgoing ? 'You: ' : group && last.from ? `${client.displayName(last.from)}: ` : '') : '';
          const preview = last
            ? who + (last.deleted ? 'Message deleted' : MessengerClient.preview(last))
            : group
              ? `${c.groupOf(key)?.members.length ?? 0} members`
              : 'No messages yet';
          return (
            <Pressable
              onPress={() => navigate({ name: 'chat', peer: key })}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}
            >
              <ChatAvatar chatKey={key} size={50} />
              <View style={styles.itemBody}>
                <View style={[s.row, { gap: 8 }]}>
                  <Text style={[s.textStrong, { flex: 1, fontSize: 16 }]} numberOfLines={1}>
                    {c.chatTitle(key)}
                  </Text>
                  {last && (
                    <Text style={[s.muted, { fontSize: 12 }, unread > 0 && { color: colors.accent, fontWeight: '600' }]}>
                      {shortTime(last.ts)}
                    </Text>
                  )}
                </View>
                <View style={[s.row, { gap: 8, marginTop: 3 }]}>
                  <Text
                    style={[
                      s.muted,
                      { flex: 1, fontSize: 14 },
                      unread > 0 && { color: colors.text2 },
                      !!typing && { color: colors.ok, fontWeight: '500' },
                    ]}
                    numberOfLines={1}
                  >
                    {typing || preview}
                  </Text>
                  {unread > 0 && (
                    <View style={styles.badge}>
                      <Text style={{ color: '#fff', fontSize: 11.5, fontWeight: '700' }}>{unread}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      {more && (
        <Sheet
          onClose={() => setMore(false)}
          actions={[
            ...(c.isAdmin && online
              ? [
                  { icon: ShieldCheck, label: 'Admin panel', onPress: () => navigate({ name: 'admin' }) },
                  { icon: Megaphone, label: 'New announcement', onPress: () => navigate({ name: 'broadcast' }) },
                ]
              : []),
            { icon: Star, label: 'Starred messages', onPress: () => navigate({ name: 'starred' }) },
            { icon: ShoppingBag, label: 'My catalog', onPress: () => navigate({ name: 'catalog' }) },
            { icon: Settings, label: 'Settings', onPress: () => navigate({ name: 'settings' }) },
          ]}
        />
      )}
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
  suggest: {
    marginHorizontal: 12,
    marginTop: -6,
    marginBottom: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  suggestItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 16 },
  itemBody: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
});
