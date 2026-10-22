import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { BadgeCheck, Check, ChevronRight, Eraser, Mail, Phone, ShoppingBag, RotateCcw, ShieldX, UserMinus } from 'lucide-react-native';
import { formatLastSeen, isGroupKey } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, mono, s } from '../theme';
import { Avatar, Button, ChatAvatar, Header, Row, errorText } from '../ui';
import type { Route } from '../App';
import { MediaSection } from './MediaScreen';
import { CatalogScreen } from './ChatExtras';

/** Confirm, then clear the chat and its saved files. */
function confirmClear(chatKey: string) {
  Alert.alert('Clear chat', 'Clear this chat and delete its saved photos and documents?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: () => client.clearChat(chatKey) },
  ]);
}

const TIMERS: [number, string][] = [
  [0, 'Off'],
  [30, '30 seconds'],
  [300, '5 minutes'],
  [3600, '1 hour'],
  [86400, '1 day'],
  [604800, '1 week'],
];

function GroupInfoScreen({
  chatKey,
  navigate,
  onError,
}: {
  chatKey: string;
  navigate: (r: Route) => void;
  onError: (m: string) => void;
}) {
  const c = useClient();
  const g = c.groupOf(chatKey);
  const me = c.account?.username;
  const [query, setQuery] = useState('');
  const members = c.groupMembers(chatKey).filter((u) => u.includes(query.trim().toLowerCase()));
  const count = g?.members.length ?? 0;
  useEffect(() => {
    void client.refreshPresence(g?.members ?? []);
  }, [g?.members]);
  return (
    <View style={s.fill}>
      <Header title="Group details" onBack={() => navigate({ name: 'chat', peer: chatKey })} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
          <ChatAvatar chatKey={chatKey} size={80} />
          <Text style={[s.h1, { fontSize: 20 }]}>{c.chatTitle(chatKey)}</Text>
          <Text style={s.muted}>
            Group · {count} member{count === 1 ? '' : 's'}
          </Text>
          {g?.senders && (
            <Text style={[s.muted, { textAlign: 'center' }]}>
              Only {g.senders.length ? g.senders.join(', ') + ' and admins' : 'admins'} can send messages
            </Text>
          )}
          <Text style={[s.muted, { textAlign: 'center', lineHeight: 19, fontSize: 12 }]}>
            Only admins can change the name or members. Every member gets their own end-to-end encrypted copy of each
            message.
          </Text>
        </View>
        <MediaSection chatKey={chatKey} navigate={navigate} onError={onError} />
        <Text style={s.section}>
          {count} member{count === 1 ? '' : 's'}
        </Text>
        {count > 8 && (
          <TextInput
            style={[s.input, { marginBottom: 8 }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search members"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
          />
        )}
        <View style={[s.card, { paddingVertical: 4 }]}>
          {!members.length && <Text style={[s.muted, { padding: 12 }]}>No members match.</Text>}
          {members.map((u, i) => (
            <View key={u}>
              {i > 0 && <View style={[s.divider, { marginLeft: 64 }]} />}
              <Pressable
                disabled={u === me}
                onPress={() =>
                  void client
                    .addContact(u)
                    .then(() => navigate({ name: 'chat', peer: u }))
                    .catch(() => {})
                }
                style={({ pressed }) => [s.row, { gap: 12, padding: 12 }, pressed && { backgroundColor: colors.hover }]}
              >
                <ChatAvatar chatKey={u} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={s.textStrong}>{u === me ? 'You' : u}</Text>
                  {u !== me && (
                    <Text style={[s.muted, { fontSize: 12 }, c.getPresence(u)?.online && { color: colors.ok }]}>
                      {formatLastSeen(c.getPresence(u)) || 'Tap to message'}
                    </Text>
                  )}
                  {!!c.profileOf(u)?.departments.length && (
                    <Text style={[s.muted, { fontSize: 11 }]} numberOfLines={1}>
                      {c.profileOf(u)!.departments.join(', ')}
                    </Text>
                  )}
                </View>
                {c.admins.includes(u) && (
                  <View style={{ backgroundColor: colors.accentSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: colors.accentText, fontSize: 11, fontWeight: '600' }}>Admin</Text>
                  </View>
                )}
              </Pressable>
            </View>
          ))}
        </View>
        {c.canClearHistory && (
          <>
            <Text style={s.section}>Privacy</Text>
            <View style={[s.card, { padding: 4 }]}>
              <Row icon={Eraser} title="Clear chat and its files" onPress={() => confirmClear(chatKey)} />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

export function ChatInfoScreen({
  peer,
  navigate,
  onError,
}: {
  peer: string;
  navigate: (r: Route) => void;
  onError: (m: string) => void;
}) {
  if (isGroupKey(peer)) return <GroupInfoScreen chatKey={peer} navigate={navigate} onError={onError} />;
  return <PersonInfoScreen peer={peer} navigate={navigate} onError={onError} />;
}

function PersonInfoScreen({
  peer,
  navigate,
  onError,
}: {
  peer: string;
  navigate: (r: Route) => void;
  onError: (m: string) => void;
}) {
  const c = useClient();
  const [safety, setSafety] = useState<{ number: string; verified: boolean } | null>(null);
  const reload = useCallback(() => void client.getSafetyNumber(peer).then(setSafety), [peer]);
  useEffect(reload, [reload]);

  const run = (fn: () => Promise<unknown>) => () =>
    fn()
      .then(reload)
      .catch((e) => onError(errorText(e)));

  const current = c.getDisappearingTimer(peer);
  // Their catalog, like a WhatsApp Business profile (shown only if they have products).
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  useEffect(() => {
    client
      .listProducts(peer)
      .then((p) => setCatalogCount(p.length))
      .catch(() => setCatalogCount(null));
  }, [peer]);

  return (
    <View style={s.fill}>
      <Header title="Conversation details" onBack={() => navigate({ name: 'chat', peer })} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
          <Avatar name={peer} size={80} />
          <Text style={[s.h1, { fontSize: 20 }]}>{peer}</Text>
          {!!c.getPresence(peer) && <Text style={s.muted}>{formatLastSeen(c.getPresence(peer))}</Text>}
          {!!c.profileOf(peer)?.departments.length && (
            <Text style={[s.muted, { fontSize: 13, fontWeight: '600', color: colors.accentText }]}>{c.profileOf(peer)!.departments.join(', ')}</Text>
          )}
          {!!c.profileOf(peer)?.phone && (
            <View style={[s.row, { gap: 5 }]}>
              <Phone size={13} color={colors.muted} />
              <Text style={s.muted} selectable>
                {c.profileOf(peer)!.phone}
              </Text>
            </View>
          )}
          {!!c.profileOf(peer)?.email && (
            <View style={[s.row, { gap: 5 }]}>
              <Mail size={13} color={colors.muted} />
              <Text style={s.muted} selectable>
                {c.profileOf(peer)!.email}
              </Text>
            </View>
          )}
        </View>

        <MediaSection chatKey={peer} navigate={navigate} onError={onError} />
        {catalogCount !== null && catalogCount > 0 && (
          <View style={[s.card, { marginTop: 12, padding: 4 }]}>
            <Row
              icon={ShoppingBag}
              title="Catalog"
              subtitle={`${catalogCount} product${catalogCount === 1 ? '' : 's'}`}
              onPress={() => setShowCatalog(true)}
              right={<ChevronRight size={18} color={colors.faint} />}
            />
          </View>
        )}

        <Text style={s.section}>Safety number</Text>
        <View style={[s.card, { padding: 16 }]}>
          {safety ? (
            <>
              <Text
                style={{
                  color: colors.text2,
                  fontFamily: mono,
                  fontSize: 16,
                  lineHeight: 28,
                  letterSpacing: 1,
                  textAlign: 'center',
                  backgroundColor: colors.surface2,
                  borderRadius: 10,
                  padding: 12,
                }}
              >
                {safety.number.replace(/(\S+ \S+ \S+ \S+) /g, '$1\n')}
              </Text>
              <Text style={[s.muted, { marginTop: 12, lineHeight: 19 }]}>
                Compare these numbers with {peer} in person or on a video call. If they match, nobody can be listening in.
              </Text>
              <Button
                style={{ marginTop: 14 }}
                variant={safety.verified ? 'secondary' : 'primary'}
                icon={safety.verified ? ShieldX : BadgeCheck}
                title={safety.verified ? 'Clear verification' : 'Mark as verified'}
                onPress={run(() => client.setVerified(peer, !safety.verified))}
              />
            </>
          ) : (
            <Text style={s.muted}>Send or receive a message first to create the secure session.</Text>
          )}
        </View>

        <Text style={s.section}>Disappearing messages</Text>
        {!c.canClearHistory ? (
          <View style={[s.card, { padding: 16 }]}>
            <Text style={[s.muted, { lineHeight: 19 }]}>
              {current
                ? `On (${TIMERS.find(([v]) => v === current)?.[1] ?? 'set by your admin'}), set by your admin.`
                : "Off. Your admin keeps chat history, so messages don't disappear."}
            </Text>
          </View>
        ) : (
        <View style={[s.card, { paddingVertical: 4 }]}>
          {TIMERS.map(([v, label], i) => (
            <View key={v}>
              {i > 0 && <View style={[s.divider, { marginLeft: 16 }]} />}
              <Pressable
                onPress={run(() => client.setDisappearingTimer(peer, v))}
                style={({ pressed }) => [
                  s.row,
                  { paddingHorizontal: 16, paddingVertical: 13 },
                  pressed && { backgroundColor: colors.hover },
                ]}
              >
                <Text style={[s.text, { flex: 1 }]}>{label}</Text>
                {current === v && <Check size={18} color={colors.accent} strokeWidth={2.4} />}
              </Pressable>
            </View>
          ))}
        </View>
        )}

        <Text style={s.section}>Privacy</Text>
        <View style={[s.card, { padding: 4 }]}>
          {c.canClearHistory && <Row icon={Eraser} title="Clear chat and its files" onPress={() => confirmClear(peer)} />}
          <Row
            icon={RotateCcw}
            title="Reset secure session"
            subtitle="Starts a fresh encryption session"
            onPress={run(() => client.resetSession(peer))}
          />
          <Row
            icon={UserMinus}
            title="Remove contact"
            danger
            onPress={() =>
              Alert.alert('Remove contact', c.canClearHistory ? `Remove ${peer} and delete the chat?` : `Remove ${peer} from your chat list? The messages are kept.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: () => {
                    navigate({ name: 'list' });
                    void client.removeContact(peer);
                  },
                },
              ])
            }
          />
        </View>
      </ScrollView>
      {showCatalog && <CatalogScreen owner={peer} onClose={() => setShowCatalog(false)} onToast={onError} />}
    </View>
  );
}
