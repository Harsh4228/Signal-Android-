import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import QRCode from 'qrcode';
import {
  Ban,
  Building2,
  Camera,
  Image as ImageIcon,
  Check,
  CircleAlert,
  CircleCheck,
  KeyRound,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Square,
  Share2,
  ShieldCheck,
  SquareCheck,
  Trash2,
  UserPlus,
  UsersRound,
} from 'lucide-react-native';
import {
  AUDIT_LABELS,
  MAX_DEPARTMENT,
  MAX_EMAIL,
  MAX_GROUP_NAME,
  MAX_NAME,
  MAX_PHONE,
  ID_RE,
  ID_RULES,
  normalizeId,
  formatLastSeen,
  shortId,
  groupKey,
  inviteCode,
  inviteMessage,
  passwordMessage,
  companyOf,
  generatePassword,
  toBase64,
  type AdminStats,
  type AdminUser,
  type AuditEntry,
  type GroupInfo,
  type InviteResponse,
  type OutgoingFile,
} from '@meetme/core';
import { pickProfilePhoto } from '../photos';
import { BirthdayField, CameraCapture } from './Profile';
import { client, useClient } from '../messenger';
import { colors, mono, s } from '../theme';
import { Avatar, Banner, Button, Field, Header, IconButton, Sheet, errorText, shortTime, useBack, type SheetAction } from '../ui';
import type { Route } from '../App';
import { HelpDeskTab } from './HelpDesk';
import { CommunitiesTab } from './AdminCommunities';
import { ReportsTab } from './Safety';
import { GroupRightsScreen, RightsTab } from './RightsScreen';

type Tab = 'overview' | 'users' | 'departments' | 'groups' | 'communities' | 'rights' | 'helpdesk' | 'reports' | 'activity' | 'settings';
type Toast = (m: string) => void;
const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['users', 'Users'],
  ['departments', 'Departments'],
  ['groups', 'Groups'],
  ['communities', 'Communities'],
  ['rights', 'Permissions'],
  ['helpdesk', 'Help desk'],
  ['reports', 'Reports'],
  ['activity', 'Activity'],
  ['settings', 'Settings'],
];

const userState = (u: AdminUser) =>
  u.moved
    ? 'Moved to another company'
    : u.banned
    ? 'Banned'
    : !u.active
      ? 'Not logged in yet'
      : formatLastSeen({ online: u.online, lastSeen: u.lastSeen }) || 'Active';

/** A QR invite to show: for a new user, or a new one for someone who already exists. */
type InviteShare = { invite: InviteResponse; name: string; email?: string; renewed: boolean };

/**
 * The QR invite: the person scans it in CellMate and only chooses a password. The admin can show it, email it
 * (opens the mail app with the instructions), share it to any app, or give a temporary password instead.
 */
function InviteCard({ share, onDone }: { share: InviteShare; onDone: () => void }) {
  useBack(onDone);
  const [server, setServer] = useState(client.account?.serverUrl ?? '');
  const [svg, setSvg] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = inviteCode(server || 'http://localhost', share.invite);
  useEffect(() => {
    QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg, () => setSvg(null));
  }, [code]);
  const local = /^https?:\/\/(localhost|127\.|10\.0\.2\.2)/i.test(server);
  const username = share.invite.username;
  const msg = temp
    ? passwordMessage(share.name, companyOf(username), shortId(username), temp)
    : inviteMessage(share.name, code, server);
  const email = () =>
    void Linking.openURL(`mailto:${encodeURIComponent(share.email ?? '')}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body)}`);
  async function usePassword() {
    setBusy(true);
    setError(null);
    try {
      const pw = generatePassword();
      await client.resetEmployeePassword(username, pw);
      setTemp(pw);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[s.card, { padding: 16, gap: 12 }]}>
      <Banner kind="ok" icon={CircleCheck}>
        {share.renewed ? `New invite for ${share.name}.` : `${share.name} created.`}{' '}
        {temp ? 'They sign in with these details and then choose their own password.' : 'They scan this in the CellMate app and choose a password.'}
      </Banner>
      {temp ? (
        <View style={[s.card, { padding: 14, gap: 6, backgroundColor: colors.surface2 }]}>
          {!!companyOf(username) && <Text style={s.text}>Company code: <Text style={s.textStrong}>{companyOf(username)}</Text></Text>}
          <Text style={s.text}>ID: <Text style={s.textStrong}>{shortId(username)}</Text></Text>
          <Text style={s.text}>Temporary password: <Text style={[s.textStrong, { fontFamily: mono }]}>{temp}</Text></Text>
        </View>
      ) : (
        <View style={{ alignSelf: 'center', padding: 10, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: colors.line }}>
          {svg ? <SvgXml xml={svg} width={220} height={220} /> : <View style={{ width: 220, height: 220 }} />}
        </View>
      )}
      {local && (
        <>
          <Field label="Server address in the QR" value={server} onChangeText={setServer} keyboardType="url" />
          <Banner kind="warn" icon={CircleAlert}>
            Other phones can't reach this address. Use the PC's network address (e.g. http://192.168.0.155:8080) or your real server.
          </Banner>
        </>
      )}
      <Text style={[s.muted, { fontSize: 12, lineHeight: 18 }]}>
        {temp
          ? 'Send these privately. The temporary password stops working once they choose their own.'
          : `Works once, until ${new Date(share.invite.expires).toLocaleString()}. Anyone with it can set up the account: show it in person or send it privately.`}
      </Text>
      {error && <Banner kind="error" icon={CircleAlert}>{error}</Banner>}
      {!!share.email && <Button variant="primary" title={`Email to ${share.email}`} icon={Mail} onPress={email} />}
      <View style={[s.row, { gap: 10 }]}>
        <Button title={share.email ? 'Other email' : 'Email'} icon={Mail} onPress={email} style={{ flex: 1 }} />
        <Button title="Share" icon={Share2} onPress={() => void Share.share({ title: msg.subject, message: msg.body })} style={{ flex: 1 }} />
      </View>
      {!temp && <Button title="Give an ID and password instead" icon={KeyRound} busy={busy} onPress={() => void usePassword()} />}
      <Button variant={share.email ? 'secondary' : 'primary'} title="Done" onPress={onDone} />
    </View>
  );
}
/** Admin: change a user's name, photo, mobile and email (users can't change these themselves). */
function ProfileEditor({ user, onDone, onToast }: { user: AdminUser; onDone: (changed: boolean) => void; onToast: Toast }) {
  useBack(() => onDone(false));
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [email, setEmail] = useState(user.email);
  const [birthday, setBirthday] = useState(user.birthday ?? '');
  /** undefined = keep, null = remove */
  const [photo, setPhoto] = useState<OutgoingFile | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (birthday === 'invalid') return onToast('Birth date: enter day, month and year (e.g. 21 08 1994)');
    setBusy(true);
    try {
      await client.setEmployeeProfile(user.username, { name, phone, email, birthday });
      if (photo !== undefined) await client.setEmployeeAvatar(user.username, photo);
      onToast(`Saved ${name || user.username}'s profile`);
      onDone(true);
    } catch (e) {
      onToast(errorText(e));
      setBusy(false);
    }
  }
  const hasPhoto = photo ? true : photo === null ? false : user.avatar !== null;
  return (
    <View style={[s.card, { padding: 16, gap: 12 }]}>
      <Text style={s.title}>Edit {user.name || user.username}</Text>
      <PhotoField photo={photo ?? null} hasCurrent={hasPhoto} user={user.username} onPick={setPhoto} onRemove={() => setPhoto(null)} onError={onToast} />
      <Field value={name} onChangeText={setName} placeholder="Full name" maxLength={MAX_NAME} autoCapitalize="words" />
      <Field value={phone} onChangeText={setPhone} placeholder="Mobile" keyboardType="phone-pad" maxLength={MAX_PHONE} />
      <Field value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" maxLength={MAX_EMAIL} />
      <BirthdayField value={birthday} onChange={setBirthday} />
      <View style={[s.row, { gap: 10 }]}>
        <Button title="Cancel" onPress={() => onDone(false)} style={{ flex: 1 }} />
        <Button variant="primary" title="Save" busy={busy} onPress={save} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

/** Profile photo: pick from the gallery, see it, remove it. */
function PhotoField({
  photo,
  hasCurrent,
  user,
  onPick,
  onRemove,
  onError,
}: {
  photo: OutgoingFile | null;
  hasCurrent: boolean;
  user?: string;
  onPick: (f: OutgoingFile) => void;
  onRemove: () => void;
  onError: (m: string) => void;
}) {
  const [ask, setAsk] = useState(false);
  const [camera, setCamera] = useState(false);
  async function choose() {
    try {
      const f = await pickProfilePhoto();
      if (f) onPick(f);
    } catch (e) {
      onError(errorText(e));
    }
  }
  return (
    <View style={[s.row, { gap: 12 }]}>
      {ask && (
        <Sheet
          title="Profile photo"
          onClose={() => setAsk(false)}
          actions={[
            { icon: Camera, label: 'Take photo', onPress: () => setCamera(true) },
            { icon: ImageIcon, label: 'Choose from gallery', onPress: () => void choose() },
          ]}
        />
      )}
      {camera && <CameraCapture onPhoto={onPick} onClose={() => setCamera(false)} onError={onError} />}
      {photo ? (
        <Image source={{ uri: `data:${photo.mime};base64,${toBase64(photo.data)}` }} style={{ width: 56, height: 56, borderRadius: 28 }} />
      ) : hasCurrent && user ? (
        <Avatar name={user} size={56} />
      ) : (
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
          <Camera size={22} color={colors.faint} />
        </View>
      )}
      <Button title={photo || hasCurrent ? 'Change photo' : 'Add photo'} icon={Camera} onPress={() => setAsk(true)} style={{ flex: 1 }} />
      {(photo || hasCurrent) && <IconButton icon={Trash2} label="Remove photo" color={colors.danger} onPress={onRemove} />}
    </View>
  );
}

/** Admin: accounts, bans, groups, org settings and the log of admin actions. */
export function AdminScreen({ navigate, onToast }: { navigate: (r: Route) => void; onToast: Toast }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [groups, setGroups] = useState<GroupInfo[] | null>(null);
  const [departments, setDepartments] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    Promise.all([client.listAllUsers(), client.listAllGroups(), client.listDepartments()])
      .then(([u, g, d]) => {
        setUsers(u);
        setGroups(g);
        setDepartments(d);
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(reload, [reload]);

  const openChat = (key: string) => navigate({ name: 'chat', peer: key });

  return (
    <View style={s.fill}>
      <Header title="Admin" onBack={() => navigate({ name: 'list' })} />
      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {TABS.map(([id, label]) => (
            <Pressable key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabActive]}>
              <Text style={[styles.tabText, tab === id && { color: colors.accent }]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {error && (
        <View style={{ padding: 16, paddingBottom: 0 }}>
          <Banner kind="error" icon={CircleAlert}>
            {error}
          </Banner>
        </View>
      )}
      {tab === 'overview' && <Overview users={users} onGo={setTab} />}
      {tab === 'users' && (
        <UsersTab users={users} departments={departments ?? []} reload={reload} onToast={onToast} openChat={openChat} />
      )}
      {tab === 'departments' && <DepartmentsTab departments={departments} users={users} reload={reload} onToast={onToast} />}
      {tab === 'groups' && <GroupsTab groups={groups} users={users} reload={reload} onToast={onToast} openChat={openChat} />}
      {tab === 'communities' && <CommunitiesTab groups={groups} onToast={onToast} />}
      {tab === 'rights' && <RightsTab users={users} groups={groups} departments={departments ?? []} onToast={onToast} />}
      {tab === 'helpdesk' && <HelpDeskTab users={users} departments={departments ?? []} onToast={onToast} />}
      {tab === 'reports' && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <ReportsTab onToast={onToast} />
        </ScrollView>
      )}
      {tab === 'activity' && <Activity />}
      {tab === 'settings' && <SettingsTab onToast={onToast} />}
    </View>
  );
}

// ------------------------------------------------------------------ overview

function Overview({ users, onGo }: { users: AdminUser[] | null; onGo: (t: Tab) => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [recent, setRecent] = useState<AuditEntry[]>([]);
  useEffect(() => {
    void client.getAdminStats().then(setStats).catch(() => {});
    void client
      .getAuditLog(5)
      .then(setRecent)
      .catch(() => {});
  }, [users]);
  const tiles: [string, number | undefined, Tab][] = [
    ['Users', stats?.users, 'users'],
    ['Online now', stats?.online, 'users'],
    ['Not logged in', stats?.pending, 'users'],
    ['Banned', stats?.banned, 'users'],
    ['Groups', stats?.groups, 'groups'],
    ['Admins', stats?.admins, 'users'],
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <View style={styles.grid}>
        {tiles.map(([label, value, go]) => (
          <Pressable key={label} onPress={() => onGo(go)} style={({ pressed }) => [s.card, styles.tile, pressed && { opacity: 0.8 }]}>
            <Text style={styles.tileValue}>{value ?? '…'}</Text>
            <Text style={s.muted}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[s.muted, { marginTop: 14, lineHeight: 19 }]}>
        Admins manage accounts and groups but can never read anyone's messages: they are end-to-end encrypted.
      </Text>
      <Text style={s.section}>Recent admin activity</Text>
      {recent.length ? <AuditCards entries={recent} /> : <Text style={s.muted}>Nothing yet.</Text>}
    </ScrollView>
  );
}

// ------------------------------------------------------------------ users

type Filter = 'all' | 'online' | 'pending' | 'banned';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['online', 'Online'],
  ['pending', 'Not logged in'],
  ['banned', 'Banned'],
];
const matches = (u: AdminUser, f: Filter) =>
  f === 'all' || (f === 'online' && u.online) || (f === 'pending' && !u.active) || (f === 'banned' && u.banned);
/** '' = every department, NO_DEPT = people without one, otherwise a department name. */
const NO_DEPT = '\u0000none';
const inDept = (u: AdminUser, d: string) => !d || (d === NO_DEPT ? !u.departments.length : u.departments.includes(d));

function UsersTab({
  users,
  departments,
  reload,
  onToast,
  openChat,
}: {
  users: AdminUser[] | null;
  departments: string[];
  reload: () => void;
  onToast: Toast;
  openChat: (key: string) => void;
}) {
  const me = client.account?.username;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [dept, setDept] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [editingProfile, setEditingProfile] = useState<AdminUser | null>(null);
  const [invite, setInvite] = useState<InviteShare | null>(null);
  // The actions for one person, as a list (an Android alert shows only three buttons).
  const [sheet, setSheet] = useState<{ title: string; actions: SheetAction[] } | null>(null);
  const iAmOwner = !!users?.find((x) => x.username === me)?.owner;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter(
      (u) => (shortId(u.username).includes(q) || u.name.toLowerCase().includes(q)) && matches(u, filter) && inDept(u, dept),
    );
  }, [users, query, filter, dept]);
  const deptCount = (d: string) => (users ?? []).filter((u) => inDept(u, d)).length;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) onToast(done);
      reload();
    } catch (e) {
      onToast(errorText(e));
    }
  };

  const manage = (u: AdminUser) => {
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void; icon?: SheetAction['icon'] }[] = [];
    // Other admins can't demote or delete the main admin.
    const protectedOwner = !!u.owner && !iAmOwner;
    const who = u.name || shortId(u.username);
    const remove = {
      text: 'Delete account',
      style: 'destructive' as const,
      onPress: () =>
        Alert.alert('Delete account', `Delete ${who} for good? They are logged out everywhere.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => void run(() => client.removeEmployee(u.username), `${who} deleted`) },
        ]),
    };
    if (u.moved) {
      // Kept in case they come back (then their groups and departments are still here); deleting frees the ID.
      Alert.alert(who, `@${shortId(u.username)} was moved to another company. The account is kept in case they come back.`, [
        remove,
        { text: 'Close', style: 'cancel' },
      ]);
      return;
    }
    if (u.active && !u.banned) buttons.push({ text: 'Message', icon: MessageSquare, onPress: () => openChat(u.username) });
    buttons.push({ text: 'Edit profile', icon: Pencil, onPress: () => setEditingProfile(u) });
    buttons.push({ text: 'Change departments', icon: Building2, onPress: () => setEditing(u) });
    buttons.push({
      text: 'New invite (QR, email or password)',
      icon: QrCode,
      onPress: () =>
        void run(async () => setInvite({ invite: await client.newInvite(u.username), name: who, email: u.email, renewed: true })),
    });
    if (!u.banned && !protectedOwner && u.username !== me) {
      buttons.push({
        icon: ShieldCheck,
        text: u.admin ? 'Remove admin' : 'Make admin',
        onPress: () =>
          Alert.alert(
            u.admin ? 'Remove admin' : 'Make admin',
            u.admin
              ? `${who} will no longer manage people, groups and settings.`
              : `${who} will manage people, groups, departments and settings, like you.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: u.admin ? 'Remove admin' : 'Make admin',
                onPress: () => void run(() => client.setUserAdmin(u.username, !u.admin), u.admin ? `${who} is no longer an admin` : `${who} is now an admin`),
              },
            ],
          ),
      });
    }
    if (!u.admin) {
      buttons.push({
        icon: Ban,
        text: u.banned ? 'Unblock' : 'Block',
        style: u.banned ? undefined : 'destructive',
        onPress: () =>
          u.banned
            ? Alert.alert('Unblock', `Unblock ${who}? They still need a new QR code from you to sign in again.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Unblock + new QR',
                  onPress: () =>
                    void run(async () => {
                      await client.setBanned(u.username, false);
                      setInvite({ invite: await client.newInvite(u.username), name: who, email: u.email, renewed: true });
                    }),
                },
                { text: 'Unblock only', onPress: () => void run(() => client.setBanned(u.username, false), `${who} unblocked`) },
              ])
            : Alert.alert(
                'Block',
                `Block ${who}? They are signed out at once and their app deletes its keys. Even after you unblock them, they can only come back with a new QR code from you.`,
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Block', style: 'destructive', onPress: () => void run(() => client.setBanned(u.username, true), `${who} blocked and signed out`) },
                ],
              ),
      });
    }
    if (!protectedOwner && u.username !== me) buttons.push({ ...remove, icon: Trash2 });
    setSheet({
      title: ` · @${shortId(u.username)}${u.owner ? ' · main admin' : ''}`,
      actions: buttons.map((b) => ({ icon: b.icon ?? Pencil, label: b.text, onPress: () => b.onPress?.() })),
    });
  };

  return (
    <>
    <FlatList
      data={shown}
      keyExtractor={(u) => u.username}
      contentContainerStyle={{ paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ padding: 16, paddingBottom: 8, gap: 12 }}>
          {invite ? (
            <InviteCard share={invite} onDone={() => setInvite(null)} />
          ) : editingProfile ? (
            <ProfileEditor
              key={editingProfile.username}
              user={editingProfile}
              onDone={(changed) => {
                setEditingProfile(null);
                if (changed) reload();
              }}
              onToast={onToast}
            />
          ) : editing ? (
            <DepartmentEditor
              key={editing.username}
              user={editing}
              departments={departments}
              onDone={(changed) => {
                setEditing(null);
                if (changed) reload();
              }}
              onToast={onToast}
            />
          ) : adding ? (
            <CreateUser
              departments={departments}
              initialDepartment={dept && dept !== NO_DEPT ? dept : ''}
              onCancel={() => setAdding(false)}
              onCreated={(s) => {
                setAdding(false);
                setInvite(s);
                reload();
              }}
              onToast={onToast}
            />
          ) : (
            <Button variant="primary" icon={UserPlus} title="Add user" onPress={() => setAdding(true)} />
          )}
          <SearchBox value={query} onChange={setQuery} placeholder="Search users by name or ID" />
          <Chips
            items={FILTERS.map(([f, label]) => [
              f,
              `${label} (${(users ?? []).filter((u) => matches(u, f) && inDept(u, dept)).length})`,
            ])}
            value={filter}
            onChange={(f) => setFilter(f as Filter)}
          />
          {departments.length > 0 && (
            <Chips
              items={[
                ['', 'All departments'],
                ...departments.map((d): [string, string] => [d, `${d} (${deptCount(d)})`]),
                [NO_DEPT, `No department (${deptCount(NO_DEPT)})`],
              ]}
              value={dept}
              onChange={setDept}
            />
          )}
        </View>
      }
      ListEmptyComponent={<Text style={[s.muted, { textAlign: 'center', marginTop: 16 }]}>{users ? 'No users match.' : 'Loading…'}</Text>}
      renderItem={({ item: u }) => (
        <Pressable
          onPress={() => (u.username !== me ? manage(u) : setEditingProfile(u))}
          style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }, u.banned && { backgroundColor: colors.dangerSoft }]}
        >
          <View>
            <Avatar name={u.username} size={42} />
            {u.online && <View style={styles.dot} />}
          </View>
          <View style={{ flex: 1 }}>
            <View style={[s.row, { gap: 6 }]}>
              <Text style={[s.textStrong, { flexShrink: 1 }]} numberOfLines={1}>
                {u.name || shortId(u.username)}
                {u.name ? <Text style={[s.muted, { fontWeight: '400' }]}> @{shortId(u.username)}</Text> : null}
                {u.username === me ? ' (you)' : ''}
              </Text>
              {u.admin && <Pill text={u.owner ? 'Main admin' : 'Admin'} />}
              {u.banned && <Pill text="Banned" danger />}
              {u.moved && <Pill text="Moved" />}
            </View>
            {(!!u.phone || !!u.email) && (
              <Text style={[s.muted, { fontSize: 11.5, marginTop: 1 }]} numberOfLines={1}>
                {[u.phone, u.email].filter(Boolean).join(' · ')}
              </Text>
            )}
            <Text style={[s.muted, { fontSize: 12, marginTop: 2 }]} numberOfLines={1}>
              {u.departments.length ? `${u.departments.join(', ')} · ` : ''}
              {userState(u)}
              {u.inviteExpires ? ' · QR waiting to be scanned' : ''}
            </Text>
          </View>
          {u.username !== me && (
            <View style={[s.row]}>
              {u.active && !u.banned && <IconButton icon={MessageSquare} label="Message" size={19} onPress={() => openChat(u.username)} />}
              <IconButton
                icon={u.banned ? CircleCheck : Ban}
                label={u.banned ? 'Unban' : 'Ban'}
                size={19}
                color={u.banned ? colors.ok : colors.muted}
                disabled={u.admin || u.moved}
                onPress={() => manage(u)}
              />
            </View>
          )}
        </Pressable>
      )}
    />
    {sheet && <Sheet title={sheet.title} actions={sheet.actions} onClose={() => setSheet(null)} />}
    </>
  );
}

/** Tick any number of departments from the admin's list (none ticked = no department). */
function DepartmentField({
  value,
  onChange,
  departments,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  departments: string[];
}) {
  const toggle = (d: string) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  return (
    <View>
      <Text style={s.label}>Departments{value.length ? ` (${value.length})` : ''}</Text>
      {departments.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {departments.map((d) => {
            const on = value.includes(d);
            return (
              <Pressable
                key={d}
                onPress={() => toggle(d)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                style={[styles.chip, on && styles.chipActive, s.row, { gap: 4 }]}
              >
                {on && <Check size={13} color={colors.accentText} />}
                <Text style={{ fontSize: 13, color: on ? colors.accentText : colors.text2, fontWeight: '500' }}>{d}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={[s.muted, { fontSize: 13 }]}>No departments yet. Add them in the Departments tab.</Text>
      )}
    </View>
  );
}

function DepartmentEditor({
  user,
  departments,
  onDone,
  onToast,
}: {
  user: AdminUser;
  departments: string[];
  onDone: (changed: boolean) => void;
  onToast: Toast;
}) {
  useBack(() => onDone(false));
  const [value, setValue] = useState(user.departments);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (value.length === user.departments.length && value.every((d) => user.departments.includes(d))) return onDone(false);
    setBusy(true);
    try {
      await client.setDepartments(user.username, value);
      onToast(value.length ? `${user.username}: ${[...value].sort().join(', ')}` : `${user.username} has no department now`);
      onDone(true);
    } catch (e) {
      onToast(errorText(e));
      setBusy(false);
    }
  }

  return (
    <View style={[s.card, { padding: 16, gap: 12 }]}>
      <Text style={s.title}>Departments of {user.username}</Text>
      <DepartmentField value={value} onChange={setValue} departments={departments} />
      <View style={[s.row, { gap: 10 }]}>
        <Button title="Cancel" onPress={() => onDone(false)} style={{ flex: 1 }} />
        <Button variant="primary" icon={Check} title="Save" busy={busy} onPress={save} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function CreateUser({
  departments,
  initialDepartment,
  onCancel,
  onCreated,
  onToast,
}: {
  departments: string[];
  initialDepartment: string;
  onCancel: () => void;
  onCreated: (s: InviteShare) => void;
  onToast: Toast;
}) {
  useBack(onCancel);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birthday, setBirthday] = useState('');
  const [photo, setPhoto] = useState<OutgoingFile | null>(null);
  const [picked, setPicked] = useState<string[]>(initialDepartment ? [initialDepartment] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    const username = normalizeId(id);
    if (!ID_RE.test(username)) return setError(ID_RULES);
    if (!name.trim()) return setError('Enter their full name');
    if (birthday === 'invalid') return setError('Birth date: enter day, month and year (e.g. 21 08 1994)');
    setBusy(true);
    try {
      const invite = await client.inviteEmployee({
        username,
        name,
        phone,
        email,
        departments: picked,
        photo: photo ? { mime: photo.mime, data: toBase64(photo.data) } : undefined,
        birthday: birthday || undefined,
      });
      onCreated({ invite, name: name.trim(), email: email.trim() || undefined, renewed: false });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.card, { padding: 16, gap: 12 }]}>
      <Text style={s.title}>Add user</Text>
      <Text style={[s.muted, { fontSize: 12, lineHeight: 18 }]}>
        Fill in their profile. You get a QR code: they scan it in the CellMate app and only choose a password. Only you can change their
        name, photo, mobile or email.
      </Text>
      <PhotoField photo={photo} hasCurrent={false} onPick={setPhoto} onRemove={() => setPhoto(null)} onError={onToast} />
      <Field value={name} onChangeText={setName} placeholder="Full name, e.g. Ravi Kumar" maxLength={MAX_NAME} autoCapitalize="words" autoFocus />
      <Field value={id} onChangeText={setId} placeholder="User ID (for sign-in), e.g. Ravi Kumar" autoCapitalize="none" autoCorrect={false} />
      <Field value={phone} onChangeText={setPhone} placeholder="Mobile, e.g. +91 98765 43210" keyboardType="phone-pad" maxLength={MAX_PHONE} />
      <Field value={email} onChangeText={setEmail} placeholder="Email" keyboardType="email-address" maxLength={MAX_EMAIL} />
      <BirthdayField value={birthday} onChange={setBirthday} />
      <DepartmentField value={picked} onChange={setPicked} departments={departments} />
      {error && (
        <Banner kind="error" icon={CircleAlert}>
          {error}
        </Banner>
      )}
      <View style={[s.row, { gap: 10 }]}>
        <Button title="Cancel" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          variant="primary"
          icon={UserPlus}
          title="Create & QR"
          busy={busy}
          disabled={normalizeId(id).length < 3 || !name.trim()}
          onPress={create}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ departments

function DepartmentsTab({
  departments,
  users,
  reload,
  onToast,
}: {
  departments: string[] | null;
  users: AdminUser[] | null;
  reload: () => void;
  onToast: Toast;
}) {
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  useBack(renaming ? () => setRenaming(null) : null);
  const [busy, setBusy] = useState(false);

  const members = (d: string) => (users ?? []).filter((u) => u.departments.includes(d)).length;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      onToast(done);
      reload();
      return true;
    } catch (e) {
      onToast(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  async function add() {
    const n = name.trim();
    if (n && (await run(() => client.addDepartment(n), `Department "${n}" added`))) setName('');
  }

  async function rename(from: string) {
    const to = newName.trim();
    if (!to || to === from) return setRenaming(null);
    if (await run(() => client.renameDepartment(from, to), `"${from}" renamed to "${to}"`)) setRenaming(null);
  }

  const manage = (d: string) => {
    const n = members(d);
    Alert.alert(d, `${n} member${n === 1 ? '' : 's'}`, [
      {
        text: 'Rename',
        onPress: () => {
          setRenaming(d);
          setNewName(d);
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete department', `Delete "${d}"?${n ? ` It is taken off its ${n} member${n === 1 ? '' : 's'} (their other departments stay).` : ''}`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => void run(() => client.deleteDepartment(d), `Department "${d}" deleted`) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <FlatList
      data={departments ?? []}
      keyExtractor={(d) => d}
      contentContainerStyle={{ paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ padding: 16, paddingBottom: 8, gap: 12 }}>
          {renaming ? (
            <View style={[s.card, { padding: 16, gap: 12 }]}>
              <Text style={s.title}>Rename "{renaming}"</Text>
              <Field value={newName} onChangeText={setNewName} maxLength={MAX_DEPARTMENT} autoCapitalize="words" autoFocus />
              <View style={[s.row, { gap: 10 }]}>
                <Button title="Cancel" onPress={() => setRenaming(null)} style={{ flex: 1 }} />
                <Button variant="primary" icon={Check} title="Save" busy={busy} onPress={() => void rename(renaming)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <View style={[s.row, { gap: 8 }]}>
              <View style={{ flex: 1 }}>
                <Field
                  value={name}
                  onChangeText={setName}
                  placeholder="New department, e.g. Sales"
                  maxLength={MAX_DEPARTMENT}
                  autoCapitalize="words"
                  onSubmitEditing={() => void add()}
                  returnKeyType="done"
                />
              </View>
              <Button variant="primary" icon={Plus} title="Add" busy={busy} disabled={!name.trim()} onPress={() => void add()} />
            </View>
          )}
          <Text style={[s.muted, { lineHeight: 19 }]}>
            Put each user in one or more departments, filter users by them, and send announcements to chosen departments only.
          </Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={[s.muted, { textAlign: 'center', marginTop: 16 }]}>
          {departments ? 'No departments yet. Add your first one above.' : 'Loading…'}
        </Text>
      }
      renderItem={({ item: d }) => (
        <Pressable onPress={() => manage(d)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}>
          <View style={styles.groupIcon}>
            <Building2 size={20} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.textStrong} numberOfLines={1}>
              {d}
            </Text>
            <Text style={[s.muted, { fontSize: 12, marginTop: 2 }]}>
              {members(d)} member{members(d) === 1 ? '' : 's'}
            </Text>
          </View>
          <IconButton icon={Pencil} label="Rename or delete" size={19} onPress={() => manage(d)} />
        </Pressable>
      )}
    />
  );
}

// ------------------------------------------------------------------ groups

function GroupsTab({
  groups,
  users,
  reload,
  onToast,
  openChat,
}: {
  groups: GroupInfo[] | null;
  users: AdminUser[] | null;
  reload: () => void;
  onToast: Toast;
  openChat: (key: string) => void;
}) {
  const me = client.account?.username ?? '';
  const [editing, setEditing] = useState<GroupInfo | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<{ title: string; actions: SheetAction[] } | null>(null);
  const [rights, setRights] = useState<GroupInfo | null>(null);

  if (rights) return <GroupRightsScreen group={rights} onClose={() => setRights(null)} onToast={onToast} />;
  if (editing) {
    return (
      <GroupEditor
        group={editing === 'new' ? null : editing}
        users={users ?? []}
        onCancel={() => setEditing(null)}
        onSaved={(g) => {
          setEditing(null);
          onToast(`Group "${g.name}" saved`);
          reload();
        }}
      />
    );
  }

  const manage = (g: GroupInfo) => {
    const buttons: SheetAction[] = [];
    if (g.members.includes(me)) buttons.push({ icon: MessageSquare, label: 'Open chat', onPress: () => openChat(groupKey(g.id)) });
    buttons.push({ icon: Pencil, label: 'Edit name, members & group admins', onPress: () => setEditing(g) });
    buttons.push({ icon: ShieldCheck, label: 'Group permissions', onPress: () => setRights(g) });
    buttons.push({
      icon: Trash2,
      label: 'Delete group',
      onPress: () =>
        Alert.alert('Delete group', `Delete "${g.name}"? Members can no longer write in it.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await client.deleteGroup(g.id);
                onToast(`Group "${g.name}" deleted`);
                reload();
              } catch (e) {
                onToast(errorText(e));
              }
            },
          },
        ]),
    });
    setSheet({ title: `${g.name} · ${g.members.length} members`, actions: buttons });
  };

  const q = query.trim().toLowerCase();
  const shown = (groups ?? []).filter((g) => g.name.toLowerCase().includes(q) || g.members.some((m) => m.includes(q)));
  return (
    <>
    <FlatList
      data={shown}
      keyExtractor={(g) => g.id}
      contentContainerStyle={{ paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ padding: 16, paddingBottom: 8, gap: 12 }}>
          <Button variant="primary" icon={Plus} title="New group" onPress={() => setEditing('new')} />
          <SearchBox value={query} onChange={setQuery} placeholder="Search groups or members" />
          <Text style={[s.muted, { lineHeight: 19 }]}>
            Only admins create groups and choose who is in them. Group messages are end-to-end encrypted for every member.
          </Text>
        </View>
      }
      ListEmptyComponent={
        <Text style={[s.muted, { textAlign: 'center', marginTop: 16 }]}>
          {groups ? (groups.length ? 'No groups match.' : 'No groups yet.') : 'Loading…'}
        </Text>
      }
      renderItem={({ item: g }) => (
        <Pressable onPress={() => manage(g)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}>
          <View style={styles.groupIcon}>
            <UsersRound size={20} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.textStrong} numberOfLines={1}>
              {g.name}
            </Text>
            <Text style={[s.muted, { fontSize: 12, marginTop: 2 }]} numberOfLines={1}>
              {g.members.length} members: {g.members.join(', ')}
              {g.senders ? ` · only ${g.senders.length ? g.senders.join(', ') : 'admins'} can send` : ''}
            </Text>
          </View>
          <IconButton icon={Pencil} label="Edit" size={19} onPress={() => setEditing(g)} />
        </Pressable>
      )}
    />
    {sheet && <Sheet title={sheet.title} actions={sheet.actions} onClose={() => setSheet(null)} />}
    </>
  );
}

function GroupEditor({
  group,
  users,
  onCancel,
  onSaved,
}: {
  group: GroupInfo | null;
  users: AdminUser[];
  onCancel: () => void;
  onSaved: (g: GroupInfo) => void;
}) {
  useBack(onCancel);
  const me = client.account?.username ?? '';
  const [name, setName] = useState(group?.name ?? '');
  const [members, setMembers] = useState<Set<string>>(() => new Set(group?.members ?? [me]));
  // Who can send: everyone, or only the people ticked here (admins always can).
  const [restrict, setRestrict] = useState(!!group?.senders);
  const [senders, setSenders] = useState<Set<string>>(() => new Set(group?.senders ?? []));
  // Group admins: members who may manage the group themselves (members, who sends, its permissions).
  const [groupAdmins, setGroupAdmins] = useState<Set<string>>(() => new Set(group?.admins ?? []));
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // New groups: a normal group, or a channel (anyone may follow it, only its admins post).
  const [kind, setKind] = useState<'group' | 'channel'>(group?.kind === 'channel' ? 'channel' : 'group');
  const isAdminUser = (u: string) => users.some((x) => x.username === u && x.admin);
  // Admins can always send, so only the other members are offered as senders.
  const senderChoices = [...members].filter((u) => !isAdminUser(u)).sort();

  const toggleSender = (u: string) =>
    setSenders((cur) => {
      const n = new Set(cur);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });

  const toggle = (u: string) =>
    setMembers((cur) => {
      const n = new Set(cur);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const list = [...members];
      const who = restrict ? [...senders].filter((u) => members.has(u)) : null;
      onSaved(
        group
          ? await client.updateGroup(group.id, { name: name.trim(), members: list, senders: who, admins: [...groupAdmins].filter((u) => members.has(u)) })
          : await client.createGroup(name.trim(), list, who, [...groupAdmins].filter((u) => members.has(u)), kind),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const q = query.trim().toLowerCase();
  return (
    <FlatList
      data={users.filter((u) => !u.moved && (shortId(u.username).includes(q) || u.name.toLowerCase().includes(q)))}
      keyExtractor={(u) => u.username}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: 32 }}
      ListHeaderComponent={
        <View style={{ padding: 16, paddingBottom: 8, gap: 12 }}>
          <Text style={s.title}>{group ? 'Edit group' : 'New group'}</Text>
          <Field value={name} onChangeText={setName} placeholder="Group name" maxLength={MAX_GROUP_NAME} autoCapitalize="sentences" />
          {error && (
            <Banner kind="error" icon={CircleAlert}>
              {error}
            </Banner>
          )}
          <View style={[s.row, { gap: 10 }]}>
            <Button title="Cancel" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              variant="primary"
              icon={Check}
              title={group ? 'Save' : 'Create'}
              busy={busy}
              disabled={!name.trim()}
              onPress={save}
              style={{ flex: 1 }}
            />
          </View>
          {!group && (
            <>
              <Text style={s.label}>Type</Text>
              <Chips
                items={[
                  ['group', 'Group'],
                  ['channel', 'Channel (anyone can follow)'],
                ]}
                value={kind}
                onChange={(v) => setKind(v as 'group' | 'channel')}
              />
            </>
          )}
          {kind === 'channel' ? (
            <Text style={[s.muted, { fontSize: 12 }]}>Only the group admins below (and company admins) post; followers read.</Text>
          ) : (
          <Text style={s.label}>Who can send messages</Text>
          )}
          {kind === 'group' && (
          <Chips
            items={[
              ['all', 'All members'],
              ['some', 'Only selected members'],
            ]}
            value={restrict ? 'some' : 'all'}
            onChange={(v) => setRestrict(v === 'some')}
          />
          )}
          {restrict && kind === 'group' && (
            <View style={{ gap: 8 }}>
              <Text style={[s.muted, { fontSize: 12 }]}>
                Tick who can send. Everyone else can only read. Admins can always send.
                {senderChoices.length && !senderChoices.some((u) => senders.has(u)) ? ' Nobody ticked: only admins can send.' : ''}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {senderChoices.map((u) => {
                  const on = senders.has(u);
                  return (
                    <Pressable
                      key={u}
                      onPress={() => toggleSender(u)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={[styles.chip, on && styles.chipActive, s.row, { gap: 4 }]}
                    >
                      {on && <Check size={13} color={colors.accentText} />}
                      <Text style={{ fontSize: 13, color: on ? colors.accentText : colors.text2, fontWeight: '500' }}>{shortId(u)}</Text>
                    </Pressable>
                  );
                })}
                {!senderChoices.length && <Text style={[s.muted, { fontSize: 12 }]}>Pick members below first.</Text>}
              </View>
            </View>
          )}
          <Text style={s.label}>Group admins</Text>
          <Text style={[s.muted, { fontSize: 12 }]}>They can add or remove members and set what members may do in this group.</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {senderChoices.map((u) => {
              const on = groupAdmins.has(u);
              return (
                <Pressable
                  key={u}
                  onPress={() =>
                    setGroupAdmins((cur) => {
                      const n = new Set(cur);
                      if (n.has(u)) n.delete(u);
                      else n.add(u);
                      return n;
                    })
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={[styles.chip, on && styles.chipActive, s.row, { gap: 4 }]}
                >
                  {on && <Check size={13} color={colors.accentText} />}
                  <Text style={{ fontSize: 13, color: on ? colors.accentText : colors.text2, fontWeight: '500' }}>{shortId(u)}</Text>
                </Pressable>
              );
            })}
            {!senderChoices.length && <Text style={[s.muted, { fontSize: 12 }]}>Pick members below first.</Text>}
          </View>
          <SearchBox value={query} onChange={setQuery} placeholder="Find people" />
          <Text style={s.muted}>{members.size} selected</Text>
        </View>
      }
      renderItem={({ item: u }) => {
        const on = members.has(u.username);
        const Icon = on ? SquareCheck : Square;
        return (
          <Pressable onPress={() => toggle(u.username)} style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.hover }]}>
            <Icon size={22} color={on ? colors.accent : colors.faint} />
            <Avatar name={u.username} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={s.textStrong}>
                {u.name || shortId(u.username)}
                {u.username === me ? ' (you)' : ''}
              </Text>
              <Text style={[s.muted, { fontSize: 12 }]}>{userState(u)}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

// ------------------------------------------------------------------ activity

function AuditCards({ entries }: { entries: AuditEntry[] }) {
  return (
    <View style={[s.card, { paddingVertical: 4 }]}>
      {entries.map((e, i) => (
        <View key={e.id}>
          {i > 0 && <View style={[s.divider, { marginLeft: 14 }]} />}
          <View style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
            <View style={[s.row, { gap: 8 }]}>
              <Text style={[s.text, { flex: 1 }]}>
                <Text style={{ fontWeight: '600' }}>{e.actor}</Text> · {AUDIT_LABELS[e.action] ?? e.action}{' '}
                <Text style={{ fontWeight: '600' }}>{e.target}</Text>
              </Text>
              <Text style={[s.muted, { fontSize: 12 }]}>{shortTime(e.ts)}</Text>
            </View>
            {!!e.detail && <Text style={[s.muted, { marginTop: 2 }]}>{e.detail}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

/** The activity log, 50 at a time (newest first); "Load older" fetches the next page. */
function Activity() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const load = useCallback((before: number | null) => {
    setLoading(true);
    client
      .getAuditPage(before)
      .then((p) => {
        setEntries((cur) => (before && cur ? [...cur, ...p.items] : p.items));
        setNext(p.next);
      })
      .catch(() => setEntries((cur) => cur ?? []))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(null), [load]);
  const q = query.trim().toLowerCase();
  const shown = (entries ?? []).filter((e) =>
    `${e.actor} ${AUDIT_LABELS[e.action] ?? e.action} ${e.target} ${e.detail}`.toLowerCase().includes(q),
  );
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
      <View style={[s.row, { gap: 4 }]}>
        <View style={{ flex: 1 }}>
          <SearchBox value={query} onChange={setQuery} placeholder="Search the loaded entries" />
        </View>
        <IconButton icon={RefreshCw} label="Refresh" onPress={() => load(null)} />
      </View>
      {entries === null ? (
        <Text style={s.muted}>Loading…</Text>
      ) : shown.length ? (
        <AuditCards entries={shown} />
      ) : (
        <Text style={s.muted}>No admin actions logged{q ? ' that match' : ' yet'}.</Text>
      )}
      {next !== null && <Button title="Load older entries" busy={loading} onPress={() => load(next)} />}
      <Text style={s.muted}>Every account, ban, group, permission and settings change is recorded here.</Text>
    </ScrollView>
  );
}
// ------------------------------------------------------------------ settings

function SettingsTab({ onToast }: { onToast: Toast }) {
  const c = useClient();
  const [busy, setBusy] = useState(false);
  const toggle = async (key: 'allowEditDelete' | 'allowClearHistory', v: boolean) => {
    setBusy(true);
    try {
      await client.setPolicy({ [key]: v });
      onToast('Settings saved');
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={[s.section, { marginTop: 4 }]}>Messages</Text>
      <View style={[s.card, s.row, { padding: 16, gap: 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.textStrong}>Employees may edit and delete their messages</Text>
          <Text style={[s.muted, { marginTop: 4, lineHeight: 19 }]}>
            When off, only admins can edit or delete messages for everyone. Admins can always remove any message in chats
            they are part of.
          </Text>
        </View>
        <Switch
          value={c.policy.allowEditDelete}
          disabled={busy}
          onValueChange={(v) => void toggle('allowEditDelete', v)}
          trackColor={{ true: colors.accent, false: colors.lineStrong }}
          thumbColor="#fff"
        />
      </View>
      <View style={[s.card, s.row, { padding: 16, gap: 12, marginTop: 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.textStrong}>Employees may clear their chat history</Text>
          <Text style={[s.muted, { marginTop: 4, lineHeight: 19 }]}>
            Clear a chat, delete a message for themselves, and turn on disappearing messages. When off, employees can't
            remove any history. Admins always can.
          </Text>
        </View>
        <Switch
          value={c.policy.allowClearHistory}
          disabled={busy}
          onValueChange={(v) => void toggle('allowClearHistory', v)}
          trackColor={{ true: colors.accent, false: colors.lineStrong }}
          thumbColor="#fff"
        />
      </View>
      <Text style={s.section}>Accounts</Text>
      <Text style={[s.muted, { lineHeight: 19 }]}>
        Only admins create accounts. Admins are set on the server (ADMIN_USERS). Banned users can't log in, send or
        receive until you unban them; their account and keys are kept.
      </Text>
    </ScrollView>
  );
}

// ------------------------------------------------------------------ small pieces

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.search}>
      <Search size={17} color={colors.faint} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function Chips({ items, value, onChange }: { items: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {items.map(([id, label]) => (
        <Pressable key={id} onPress={() => onChange(id)} style={[styles.chip, value === id && styles.chipActive]}>
          <Text style={{ fontSize: 13, color: value === id ? colors.accentText : colors.text2, fontWeight: '500' }}>{label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Pill({ text, danger }: { text: string; danger?: boolean }) {
  return (
    <View
      style={{
        backgroundColor: danger ? colors.dangerSoft : colors.accentSoft,
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 1,
      }}
    >
      <Text style={{ color: danger ? '#b42318' : colors.accentText, fontSize: 11, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabsWrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.lineStrong,
  },
  tabs: { paddingHorizontal: 8, gap: 2 },
  tab: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.accent },
  tabText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48%', flexGrow: 1, padding: 14, gap: 2 },
  tileValue: { color: colors.text, fontSize: 26, fontWeight: '700' },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.online,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  groupIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: '#b9cbf7' },
});
