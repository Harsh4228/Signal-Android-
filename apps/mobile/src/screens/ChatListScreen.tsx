import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Megaphone, MessageSquarePlus, Settings, UserPlus, Users } from 'lucide-react-native';
import { MessengerClient } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, Header, IconButton, Logo, errorText, shortTime } from '../ui';
import type { Route } from '../App';

export function ChatListScreen({ navigate, onError }: { navigate: (r: Route) => void; onError: (m: string) => void }) {
  const c = useClient();
  const [adding, setAdding] = useState('');

  async function add() {
    const name = adding.trim().toLowerCase();
    if (!name) return;
    try {
      await client.addContact(name);
      setAdding('');
      navigate({ name: 'chat', peer: name });
    } catch (e) {
      onError(errorText(e));
    }
  }

  const sorted = [...c.contacts].sort((a, b) => (c.lastMessage(b)?.ts ?? 0) - (c.lastMessage(a)?.ts ?? 0));
  const online = c.status === 'online';
  const statusColor = online ? colors.online : c.status === 'connecting' ? '#f79009' : colors.danger;

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
            <Text style={[s.title, { fontSize: 19, fontWeight: '700' }]}>MeetMe</Text>
            <View style={[s.row, { gap: 5 }]}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
              <Text style={[s.muted, { fontSize: 12, textTransform: 'capitalize' }]}>
                {c.account!.username} · {c.status}
              </Text>
            </View>
          </View>
        }
        right={
          <>
            {c.isAdmin && (
              <IconButton icon={Users} label="Employees" disabled={!online} onPress={() => navigate({ name: 'employees' })} />
            )}
            {c.isAdmin && (
              <IconButton icon={Megaphone} label="Announcement" disabled={!online} onPress={() => navigate({ name: 'broadcast' })} />
            )}
            <IconButton icon={Settings} label="Settings" onPress={() => navigate({ name: 'settings' })} />
          </>
        }
      />

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
          onSubmitEditing={add}
          returnKeyType="go"
        />
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(n) => n}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={[s.center, { gap: 8 }]}>
            <View style={styles.emptyIcon}>
              <MessageSquarePlus size={28} color={colors.accent} />
            </View>
            <Text style={s.title}>No conversations yet</Text>
            <Text style={[s.muted, { textAlign: 'center' }]}>Type a username above to start a secure chat.</Text>
          </View>
        }
        renderItem={({ item: name }) => {
          const last = c.lastMessage(name);
          const unread = c.getUnread(name);
          return (
            <Pressable
              onPress={() => navigate({ name: 'chat', peer: name })}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}
            >
              <Avatar name={name} size={50} />
              <View style={styles.itemBody}>
                <View style={[s.row, { gap: 8 }]}>
                  <Text style={[s.textStrong, { flex: 1, fontSize: 16 }]} numberOfLines={1}>
                    {name}
                  </Text>
                  {last && (
                    <Text style={[s.muted, { fontSize: 12 }, unread > 0 && { color: colors.accent, fontWeight: '600' }]}>
                      {shortTime(last.ts)}
                    </Text>
                  )}
                </View>
                <View style={[s.row, { gap: 8, marginTop: 3 }]}>
                  <Text style={[s.muted, { flex: 1, fontSize: 14 }, unread > 0 && { color: colors.text2 }]} numberOfLines={1}>
                    {last ? (last.outgoing ? 'You: ' : '') + MessengerClient.preview(last) : 'No messages yet'}
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
