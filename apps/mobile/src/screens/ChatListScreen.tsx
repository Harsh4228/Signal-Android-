import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { MessengerClient } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
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
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  const sorted = [...c.contacts].sort((a, b) => (c.lastMessage(b)?.ts ?? 0) - (c.lastMessage(a)?.ts ?? 0));
  const statusColor = c.status === 'online' ? colors.ok : c.status === 'connecting' ? 'orange' : colors.danger;

  return (
    <View style={s.fill}>
      <View style={s.header}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{c.account!.username[0]!.toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.text, { fontWeight: '700' }]}>
            {c.account!.username}
            {c.isAdmin ? <Text style={{ color: '#f5a524', fontSize: 11 }}> ADMIN</Text> : null}
          </Text>
          <Text style={[s.muted, { color: statusColor }]}>● {c.status}</Text>
        </View>
        {c.isAdmin && c.status === 'online' && (
          <Pressable style={s.iconBtn} onPress={() => navigate({ name: 'employees' })}>
            <Text style={s.icon}>👥</Text>
          </Pressable>
        )}
        {c.isAdmin && c.status === 'online' && (
          <Pressable style={s.iconBtn} onPress={() => navigate({ name: 'broadcast' })}>
            <Text style={s.icon}>📢</Text>
          </Pressable>
        )}
        <Pressable style={s.iconBtn} onPress={() => navigate({ name: 'settings' })}>
          <Text style={s.icon}>⚙</Text>
        </Pressable>
      </View>

      <View style={[s.row, { padding: 10, gap: 8 }]}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={adding}
          onChangeText={setAdding}
          placeholder="Add contact by username"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={add}
          returnKeyType="done"
        />
        <Pressable style={[s.button, s.primary, { marginTop: 0 }]} onPress={add}>
          <Text style={s.buttonText}>Add</Text>
        </Pressable>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(n) => n}
        ListEmptyComponent={<Text style={[s.muted, { padding: 20, textAlign: 'center' }]}>No contacts yet</Text>}
        renderItem={({ item: name }) => {
          const last = c.lastMessage(name);
          const unread = c.getUnread(name);
          return (
            <Pressable
              onPress={() => navigate({ name: 'chat', peer: name })}
              style={({ pressed }) => [
                s.row,
                { paddingHorizontal: 14, paddingVertical: 10, gap: 12 },
                pressed && { backgroundColor: colors.panel2 },
              ]}
            >
              <View style={s.avatar}>
                <Text style={s.avatarText}>{name[0]!.toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.text, { fontWeight: '600' }]}>{name}</Text>
                <Text style={s.muted} numberOfLines={1}>
                  {last ? (last.outgoing ? 'You: ' : '') + MessengerClient.preview(last) : ' '}
                </Text>
              </View>
              {unread > 0 && (
                <View style={{ backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 7 }}>
                  <Text style={[s.text, { fontSize: 12 }]}>{unread}</Text>
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
