import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Archive, ArchiveRestore, BellOff, Ban, Bell, ChevronLeft, EllipsisVertical, LifeBuoy, Megaphone, Pin, PinOff, ShoppingBag, Star, MessageSquarePlus, Search, Settings, ShieldCheck } from 'lucide-react-native';
import { MessengerClient, isGroupKey } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Banner, Button, ChatAvatar, Field, Header, IconButton, Sheet, shortTime, typingText } from '../ui';
import { DirectoryList, openDirectChat } from './DirectoryScreen';
import { AvatarTap } from './Profile';
import type { Route } from '../App';

export function ChatListScreen({ navigate, onError }: { navigate: (r: Route) => void; onError: (m: string) => void }) {
  const c = useClient();
  const [filter, setFilter] = useState('');
  const [more, setMore] = useState(false);
  const [archived, setArchived] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const q = filter.trim().toLowerCase();
  const all = c.chatKeys();
  // Pinned first, then the newest; archived chats have their own list (like WhatsApp).
  const sorted = c.orderedChats({ archived }).filter((k) => !q || c.chatTitle(k).toLowerCase().includes(q));
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const online = c.status === 'online';
  const statusColor = c.banned ? colors.danger : online ? colors.online : c.status === 'connecting' ? '#f79009' : colors.danger;

  return (
    <View style={s.screen}>
      <Header
        title={
          <View>
            <Text style={[s.title, { fontSize: 22, fontWeight: '700' }]}>{archived ? 'Archived' : 'Chats'}</Text>
            {(!online || c.banned) && (
              <View style={[s.row, { gap: 5 }]}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
                <Text style={[s.muted, { fontSize: 12, textTransform: 'capitalize' }]}>{c.banned ? 'suspended' : c.status}</Text>
              </View>
            )}
          </View>
        }
        right={
          <>
            <IconButton icon={LifeBuoy} label="Help desk" onPress={() => navigate({ name: 'help' })} />
            {/* Everything else lives in the ⋮ menu, like WhatsApp; the main pages are in the bottom bar. */}
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

      {c.backupNeedsPassword && <BackupPrompt onError={onError} />}

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

      {archived ? (
        <Pressable onPress={() => setArchived(false)} style={[s.row, { gap: 10, paddingHorizontal: 16, paddingVertical: 12 }]}>
          <ChevronLeft size={20} color={colors.accent} />
          <Text style={[s.textStrong, { color: colors.accent }]}>Archived chats</Text>
        </Pressable>
      ) : (
        c.archivedCount > 0 && (
          <Pressable onPress={() => setArchived(true)} style={[s.row, { gap: 14, paddingHorizontal: 22, paddingVertical: 12 }]}>
            <Archive size={20} color={colors.muted} />
            <Text style={[s.textStrong, { flex: 1 }]}>Archived</Text>
            <Text style={s.muted}>{c.archivedCount}</Text>
          </Pressable>
        )
      )}
      <FlatList
        data={sorted}
        keyExtractor={(n) => n}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        ListEmptyComponent={
          q || archived ? (
            <View style={[s.center, { gap: 8 }]}>
              <Text style={s.title}>{archived && !q ? 'No archived chats' : 'No chats match'}</Text>
            </View>
          ) : (
            // First login: show everyone at once, no need to search for names.
            <DirectoryList embedded onOpen={(u) => void openDirectChat(u, navigate, onError)} />
          )
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
              onLongPress={() => setActing(key)}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}
            >
              {group ? <ChatAvatar chatKey={key} size={50} /> : <AvatarTap user={key} size={50} navigate={navigate} onToast={onError} />}
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
                  {c.isMuted(key) && <BellOff size={15} color={colors.faint} />}
                  {c.isPinned(key) && <Pin size={15} color={colors.faint} />}
                  {c.mentionsMe(key) && (
                    <View style={[styles.badge, { minWidth: 22 }]}>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>@</Text>
                    </View>
                  )}
                  {unread > 0 && (
                    <View style={[styles.badge, c.isMuted(key) && { backgroundColor: colors.faint }]}>
                      <Text style={{ color: '#fff', fontSize: 11.5, fontWeight: '700' }}>{unread}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          );
        }}
      />
      {all.length > 0 && (
        <Pressable
          onPress={() => navigate({ name: 'contacts' })}
          accessibilityLabel="New chat"
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
        >
          <MessageSquarePlus size={24} color="#fff" />
        </Pressable>
      )}
      {acting && (
        <Sheet
          title={c.chatTitle(acting)}
          onClose={() => setActing(null)}
          actions={[
            c.isPinned(acting)
              ? { icon: PinOff, label: 'Unpin', onPress: () => run(() => client.pinChat(acting, false)) }
              : { icon: Pin, label: 'Pin to top', onPress: () => run(() => client.pinChat(acting, true)) },
            c.isArchived(acting)
              ? { icon: ArchiveRestore, label: 'Unarchive', onPress: () => run(() => client.archiveChat(acting, false)) }
              : { icon: Archive, label: 'Archive', onPress: () => run(() => client.archiveChat(acting, true)) },
            ...(c.isMuted(acting)
              ? [{ icon: Bell, label: 'Unmute', onPress: () => run(() => client.muteChat(acting, 0)) }]
              : [
                  { icon: BellOff, label: 'Mute for 8 hours', onPress: () => run(() => client.muteChat(acting, 8 * 3600_000)) },
                  { icon: BellOff, label: 'Mute for 1 week', onPress: () => run(() => client.muteChat(acting, 7 * 86400_000)) },
                  { icon: BellOff, label: 'Mute always', onPress: () => run(() => client.muteChat(acting, Infinity)) },
                ]),
          ]}
        />
      )}
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
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    width: 58,
    height: 58,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
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
});

/** Signed in from before chat backups existed: one password entry turns the backup on (chats then follow to any device). */
function BackupPrompt({ onError }: { onError: (m: string) => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await client.enableBackup(pw);
      onError('Chat backup is on: your chats now follow you to every device');
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ margin: 12, marginBottom: 0, gap: 8 }}>
      <Banner kind="warn">Turn on chat backup so your chats come back on any device you sign in to. Enter your login password once.</Banner>
      <Field value={pw} onChangeText={setPw} placeholder="Your login password" secureTextEntry />
      <Button variant="primary" title="Turn on chat backup" busy={busy} disabled={!pw} onPress={() => void save()} />
    </View>
  );
}