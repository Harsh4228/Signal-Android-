import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ban, BadgeCheck, Building2, Cake, Check, ChevronDown, ChevronRight, KeyRound, CircleDashed, Eraser, Flag, Mail, MessageSquare, Phone, ShieldCheck, ShieldPlus, ShoppingBag, RotateCcw, ShieldX, UserMinus, UserPlus, Video } from 'lucide-react-native';
import { birthdayText, formatLastSeen, groupIdOf, isGroupKey, shortId, type UserProfile } from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { AvatarTap, DetailRow, ProfileHero, telLink } from './Profile';
import { colors, mono, s } from '../theme';
import { Avatar, Button, ChatAvatar, Header, Row, Sheet, errorText, useBack } from '../ui';
import type { Route } from '../App';
import { MediaSection } from './MediaScreen';
import { CatalogScreen } from './ChatExtras';
import { GroupRightsScreen } from './RightsScreen';
import { ReportSheet, confirmBlock } from './Safety';

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
  const [rights, setRights] = useState(false);
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const manage = c.isGroupAdmin(chatKey);
  const groupAdmins = g?.admins ?? [];
  const q = query.trim().toLowerCase();
  const members = c.groupMembers(chatKey).filter((u) => !q || ` ${client.displayName(u)}`.toLowerCase().includes(q));
  const change = (changes: { members?: string[]; admins?: string[] }, done: string) =>
    void client
      .updateMyGroup(groupIdOf(chatKey), changes)
      .then(() => onError(done), (e) => onError(errorText(e)));
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
            {manage
              ? 'You manage this group: add people, choose group admins and set what members may do here.'
              : 'Only admins can change the name or members.'}{' '}
            Every member gets their own end-to-end encrypted copy of each message.
          </Text>
        </View>
        <MediaSection chatKey={chatKey} navigate={navigate} onError={onError} />
        {manage && g && (
          <View style={[s.card, { marginTop: 12, padding: 4 }]}>
            <Row icon={UserPlus} title="Add members" onPress={() => setAdding(true)} right={<ChevronRight size={18} color={colors.faint} />} />
            <Row
              icon={ShieldCheck}
              title="Group permissions"
              subtitle="Downloads, screenshots, forwarding… in this group"
              onPress={() => setRights(true)}
              right={<ChevronRight size={18} color={colors.faint} />}
            />
          </View>
        )}
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
                disabled={u === me && !manage}
                onLongPress={manage ? () => setActing(u) : undefined}
                onPress={() =>
                  manage
                    ? setActing(u)
                    : void client
                        .addContact(u)
                        .then(() => navigate({ name: 'chat', peer: u }))
                        .catch(() => {})
                }
                style={({ pressed }) => [s.row, { gap: 12, padding: 12 }, pressed && { backgroundColor: colors.hover }]}
              >
                {u === me ? <ChatAvatar chatKey={u} size={40} /> : <AvatarTap user={u} size={40} navigate={navigate} onToast={onError} />}
                <View style={{ flex: 1 }}>
                  <Text style={s.textStrong}>{u === me ? 'You' : client.displayName(u)}</Text>
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
                {groupAdmins.includes(u) && !c.admins.includes(u) && (
                  <View style={{ backgroundColor: colors.okSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ color: colors.ok, fontSize: 11, fontWeight: '600' }}>Group admin</Text>
                  </View>
                )}
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
      {acting && g && (
        <Sheet
          title={acting === me ? 'You' : client.displayName(acting)}
          onClose={() => setActing(null)}
          actions={[
            ...(acting !== me
              ? [{ icon: MessageSquare, label: 'Message', onPress: () => void client.addContact(acting).then(() => navigate({ name: 'chat', peer: acting })) }]
              : []),
            groupAdmins.includes(acting)
              ? { icon: ShieldX, label: 'Dismiss as group admin', onPress: () => change({ admins: groupAdmins.filter((u) => u !== acting) }, 'Group admins changed') }
              : { icon: ShieldPlus, label: 'Make group admin', onPress: () => change({ admins: [...groupAdmins, acting] }, 'Group admins changed') },
            ...(acting !== me
              ? [{ icon: UserMinus, label: 'Remove from group', onPress: () => change({ members: g.members.filter((u) => u !== acting) }, 'Removed from the group') }]
              : []),
          ]}
        />
      )}
      {adding && g && (
        <AddMembers
          members={g.members}
          onClose={() => setAdding(false)}
          onAdd={(list) => {
            setAdding(false);
            change({ members: [...g.members, ...list] }, `Added ${list.length} to the group`);
          }}
        />
      )}
      {rights && g && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <GroupRightsScreen group={g} onClose={() => setRights(false)} onToast={onError} />
        </View>
      )}
    </View>
  );
}

/** Group admins: pick colleagues to add (from the company directory). */
function AddMembers({ members, onClose, onAdd }: { members: string[]; onClose: () => void; onAdd: (list: string[]) => void }) {
  useBack(onClose);
  const [people, setPeople] = useState<UserProfile[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    client.listDirectory().then(setPeople, () => setPeople([]));
  }, []);
  const q = query.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !members.includes(p.username) && `${p.name} ${p.username}`.toLowerCase().includes(q));
  return (
    <View style={[s.fill, { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }]}>
      <Header title="Add members" onBack={onClose} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 8 }} keyboardShouldPersistTaps="handled">
        <TextInput
          style={s.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search colleagues"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {people === null && <Text style={s.muted}>Loading…</Text>}
        {people && !shown.length && <Text style={s.muted}>Everyone is already in the group.</Text>}
        <View style={[s.card, { paddingVertical: 4 }]}>
          {shown.map((p) => {
            const on = picked.includes(p.username);
            return (
              <Pressable
                key={p.username}
                onPress={() => setPicked(on ? picked.filter((u) => u !== p.username) : [...picked, p.username])}
                style={({ pressed }) => [s.row, { gap: 12, padding: 12 }, pressed && { backgroundColor: colors.hover }]}
              >
                <Avatar name={p.username} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={s.textStrong}>{p.name || p.username}</Text>
                  {!!p.departments.length && <Text style={s.muted}>{p.departments.join(', ')}</Text>}
                </View>
                {on && <Check size={20} color={colors.accent} strokeWidth={2.4} />}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16 }}>
        <Button variant="primary" title={picked.length ? `Add ${picked.length}` : 'Add'} disabled={!picked.length} onPress={() => onAdd(picked)} />
      </View>
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
  const profile = c.profileOf(peer);
  const [showSafety, setShowSafety] = useState(false);
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
  const [reporting, setReporting] = useState(false);
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
        <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
          <ProfileHero user={peer} />
          <Text style={[s.h1, { fontSize: 22, marginTop: 6 }]}>{client.displayName(peer)}</Text>
          <Text style={s.muted}>@{shortId(peer)}</Text>
          {!!c.getPresence(peer) && <Text style={s.muted}>{formatLastSeen(c.getPresence(peer))}</Text>}
          {!!profile?.about && <Text style={[s.text, { textAlign: 'center', color: colors.text2 }]}>{profile.about}</Text>}
          <View style={[s.row, { gap: 10, marginTop: 6 }]}>
            <Button title="Voice" icon={Phone} onPress={() => void calls.startCall(peer, false).catch((e) => onError(errorText(e)))} />
            <Button title="Video" icon={Video} onPress={() => void calls.startCall(peer, true).catch((e) => onError(errorText(e)))} />
          </View>
        </View>

        {!!c.statusRingOf(peer) && (
          <View style={[s.card, { marginTop: 12, padding: 4 }]}>
            <Row
              icon={CircleDashed}
              title="Status"
              subtitle={c.statusRingOf(peer) === 'new' ? 'New update' : 'Viewed'}
              onPress={() => navigate({ name: 'status-view', user: peer, start: client.statusStartOf(peer) })}
              right={<ChevronRight size={18} color={colors.faint} />}
            />
          </View>
        )}

        <View style={[s.card, { marginTop: 12, paddingHorizontal: 12, paddingVertical: 2 }]}>
          {!!profile?.departments.length && <DetailRow icon={Building2} value={profile.departments.join(', ')} label="Department" />}
          {!!profile?.phone && <DetailRow icon={Phone} value={profile.phone} label="Mobile · tap to call" link={telLink(profile.phone)} />}
          {!!profile?.email && <DetailRow icon={Mail} value={profile.email} label="Email · tap to write" link={`mailto:${profile.email}`} />}
          {!!birthdayText(profile?.birthday) && <DetailRow icon={Cake} value={birthdayText(profile?.birthday)} label="Birth date" />}
          {!profile?.departments.length && !profile?.phone && !profile?.email && !birthdayText(profile?.birthday) && (
            <DetailRow icon={Building2} value="No details yet" label="Your admin adds department, mobile, email and birth date" />
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
            icon={Ban}
            title={c.isBlocked(peer) ? `Unblock ${client.displayName(peer)}` : `Block ${client.displayName(peer)}`}
            subtitle={c.isBlocked(peer) ? 'They can message and call you again' : "They can't message or call you"}
            danger={!c.isBlocked(peer)}
            onPress={() => confirmBlock(peer, onError)}
          />
          <Row icon={Flag} title={`Report ${client.displayName(peer)}`} subtitle="Tell your admin about messages or behaviour" danger onPress={() => setReporting(true)} />
          <Row
            icon={UserMinus}
            title="Remove contact"
            danger
            onPress={() =>
              Alert.alert('Remove contact', c.canClearHistory ? `Remove ${client.displayName(peer)} and delete the chat?` : `Remove ${client.displayName(peer)} from your chat list? The messages are kept.`, [
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
        {/* Encryption check: folded away (most people never need it); open it to compare the numbers. */}
        <View style={[s.card, { marginTop: 16, padding: 4 }]}>
          <Row
            icon={KeyRound}
            title={`Safety number${safety?.verified ? ' · verified' : ''}`}
            subtitle="Check that your chat is end-to-end encrypted"
            onPress={() => setShowSafety(!showSafety)}
            right={showSafety ? <ChevronDown size={18} color={colors.faint} /> : <ChevronRight size={18} color={colors.faint} />}
          />
        </View>
        {showSafety && (
        <View style={[s.card, { padding: 16, marginTop: 8 }]}>
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
                Compare these numbers with {client.displayName(peer)} in person or on a video call. If they match, nobody can be listening in.
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
        )}
      </ScrollView>
      {showCatalog && <CatalogScreen owner={peer} onClose={() => setShowCatalog(false)} onToast={onError} />}
      {reporting && <ReportSheet user={peer} onClose={() => setReporting(false)} onToast={onError} />}
    </View>
  );
}
