import { useCallback, useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import {
  Ban,
  Building2,
  Camera,
  Check,
  CircleCheck,
  Copy,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import {
  AUDIT_LABELS,
  MAX_DEPARTMENT,
  MAX_EMAIL,
  MAX_GROUP_NAME,
  MAX_NAME,
  MAX_PHONE,
  ID_RE,
  shortId,
  formatLastSeen,
  fromBase64,
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
} from '@meetme/core';
import { client, useClient } from '../messenger';
import { Avatar, errorText, shortTime } from './ui';
import { HelpDeskTab, RightsTab } from './AdminRights';
import { CommunitiesTab } from './Channels';

type Tab = 'overview' | 'users' | 'departments' | 'groups' | 'communities' | 'rights' | 'helpdesk' | 'activity' | 'settings';
/** A QR invite to show: for a new user, or a new one for someone who already exists. */
type Share = { invite: InviteResponse; name: string; email?: string; renewed: boolean };
type Toast = (m: string) => void;

const TABS: [Tab, string, typeof Users][] = [
  ['overview', 'Overview', LayoutDashboard],
  ['users', 'Users', Users],
  ['departments', 'Departments', Building2],
  ['groups', 'Groups', UsersRound],
  ['communities', 'Communities', Building2],
  ['rights', 'Permissions', KeyRound],
  ['helpdesk', 'Help desk', LifeBuoy],
  ['activity', 'Activity log', ScrollText],
  ['settings', 'Settings', Settings2],
];

const userState = (u: AdminUser) =>
  u.moved
    ? 'Moved to another company (account kept in case they come back)'
    : u.banned
    ? 'Banned'
    : !u.active
      ? 'Not logged in yet'
      : formatLastSeen({ online: u.online, lastSeen: u.lastSeen }) || 'Active';

/** Everything an admin manages: accounts, bans, groups, org settings and the log of admin actions. */
export function AdminPanel({ onClose, onToast }: { onClose: () => void; onToast: Toast }) {
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

  const openChat = (key: string) => {
    client.setActiveChat(key);
    onClose();
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal admin" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <ShieldCheck size={18} />
            </span>
            Admin
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <nav className="tabs">
          {TABS.map(([id, label, Icon]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        {error && <div className="error">{error}</div>}
        <div className="admin-body">
          {tab === 'overview' && <Overview users={users} onGo={setTab} />}
          {tab === 'users' && (
            <UsersTab
              users={users}
              departments={departments ?? []}
              reload={reload}
              onToast={onToast}
              openChat={openChat}
              onManageDepartments={() => setTab('departments')}
            />
          )}
          {tab === 'departments' && (
            <DepartmentsTab departments={departments} users={users} reload={reload} onToast={onToast} />
          )}
          {tab === 'groups' && (
            <GroupsTab groups={groups} users={users} reload={reload} onToast={onToast} openChat={openChat} />
          )}
          {tab === 'communities' && <CommunitiesTab groups={groups} onToast={onToast} />}
          {tab === 'rights' && <RightsTab users={users} groups={groups} departments={departments ?? []} onToast={onToast} />}
          {tab === 'helpdesk' && <HelpDeskTab users={users} departments={departments ?? []} onToast={onToast} />}
          {tab === 'activity' && <Activity />}
          {tab === 'settings' && <SettingsTab onToast={onToast} />}
        </div>
      </div>
    </div>
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
    ['Not logged in yet', stats?.pending, 'users'],
    ['Banned', stats?.banned, 'users'],
    ['Groups', stats?.groups, 'groups'],
    ['Admins', stats?.admins, 'users'],
  ];
  return (
    <>
      <div className="stat-grid">
        {tiles.map(([label, value, go]) => (
          <button key={label} className="stat" onClick={() => onGo(go)}>
            <span className="stat-value">{value ?? '…'}</span>
            <span className="stat-label">{label}</span>
          </button>
        ))}
      </div>
      <p className="muted small" style={{ margin: '12px 0 0' }}>
        Admins manage accounts and groups but can never read anyone's messages: they are end-to-end encrypted.
      </p>
      <div className="section-title">Recent admin activity</div>
      {recent.length ? <AuditList entries={recent} /> : <p className="muted small">Nothing yet.</p>}
    </>
  );
}

// ------------------------------------------------------------------ users

type Filter = 'all' | 'online' | 'pending' | 'banned';
/** '' = every department, NO_DEPT = people without one, otherwise a department name. */
const NO_DEPT = '\u0000none';

function UsersTab({
  users,
  departments,
  reload,
  onToast,
  openChat,
  onManageDepartments,
}: {
  users: AdminUser[] | null;
  departments: string[];
  reload: () => void;
  onToast: Toast;
  openChat: (key: string) => void;
  onManageDepartments: () => void;
}) {
  const me = client.account?.username;
  // Other admins can't demote or delete the company's main admin.
  // Big companies: the first 100 matches, then more on request (keeps the panel fast).
  const [limit, setLimit] = useState(100);
  const iAmOwner = !!users?.find((x) => x.username === me)?.owner;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [dept, setDept] = useState('');
  const [adding, setAdding] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<string | null>(null);

  const inDept =(u: AdminUser) => !dept || (dept === NO_DEPT ? !u.departments.length : u.departments.includes(dept));

  const q = query.trim().toLowerCase();
  const shown = (users ?? []).filter(
    (u) =>
      (shortId(u.username).includes(q) || u.name.toLowerCase().includes(q)) &&
      inDept(u) &&
      (filter === 'all' ||
        (filter === 'online' && u.online) ||
        (filter === 'pending' && !u.active) ||
        (filter === 'banned' && u.banned)),
  );

  const act = (fn: () => Promise<unknown>, done?: string) => async () => {
    try {
      await fn();
      if (done) onToast(done);
      reload();
    } catch (e) {
      onToast(errorText(e));
    }
  };

  async function newQr(u: AdminUser) {
    const who = u.name || shortId(u.username);
    const msg = u.active
      ? `Make a new QR code for ${who}? Use it for a new phone or a forgotten password: scanning it lets them choose a new password, and signs out their old device.`
      : `Make a new QR code for ${who}? Their old QR code stops working.`;
    if (!confirm(msg)) return;
    await act(async () => setShare({ invite: await client.newInvite(u.username), name: who, email: u.email, renewed: true }))();
  }

  const ban = async (u: AdminUser) => {
    const who = u.name || shortId(u.username);
    if (!u.banned) {
      const yes = confirm(
        `Block ${who}? They are signed out at once and their app deletes its keys. Their password stops working: ` +
          `even after you unblock them, they can only come back with a new QR code from you.`,
      );
      if (yes) await act(() => client.setBanned(u.username, true), `${who} blocked and signed out`)();
      return;
    }
    if (!confirm(`Unblock ${who}? They still need a new QR code from you to sign in again.`)) return;
    await act(() => client.setBanned(u.username, false), `${who} unblocked`)();
    // Their permission to come back: a new QR code (now, or later with the QR button).
    if (confirm(`Make ${who}'s new QR code now?`)) {
      await act(async () => setShare({ invite: await client.newInvite(u.username), name: who, email: u.email, renewed: true }))();
    }
  };

  const remove = (u: string) => {
    if (confirm(`Delete ${shortId(u)}? Their account is removed for good and they are logged out everywhere.`)) {
      void act(() => client.removeEmployee(u), `${shortId(u)} deleted`)();
    }
  };

  const toggleAdmin = (u: AdminUser) => {
    const who = u.name || shortId(u.username);
    const text = u.admin
      ? `Remove ${who} as admin? They will no longer manage people, groups and settings.`
      : `Make ${who} an admin? They will manage people, groups, departments and settings, like you.`;
    if (confirm(text)) void act(() => client.setUserAdmin(u.username, !u.admin), u.admin ? `${who} is no longer an admin` : `${who} is now an admin`)();
  };

  const count = (f: Filter) =>
    (users ?? []).filter(
      (u) => inDept(u) && (f === 'all' ? true : f === 'online' ? u.online : f === 'pending' ? !u.active : u.banned),
    ).length;
  const deptCount = (d: string) => (users ?? []).filter((u) => (d === NO_DEPT ? !u.departments.length : u.departments.includes(d))).length;

  return (
    <>
      {share ? (
        <InviteView share={share} onDone={() => setShare(null)} onToast={onToast} />
      ) : adding ? (
        <CreateUser
          departments={departments}
          initialDepartment={dept && dept !== NO_DEPT ? dept : ''}
          onManageDepartments={onManageDepartments}
          onCancel={() => setAdding(false)}
          onCreated={(s) => {
            setAdding(false);
            setShare(s);
            reload();
          }}
        />
      ) : null}

      <div className="row" style={{ marginTop: 4 }}>
        <div className="search grow">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users by name or ID" />
        </div>
        <select
          className="dept-select"
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          title="Filter by department"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d} ({deptCount(d)})
            </option>
          ))}
          <option value={NO_DEPT}>No department ({deptCount(NO_DEPT)})</option>
        </select>
        {!adding && !share && (
          <button className="primary" onClick={() => setAdding(true)}>
            <UserPlus size={16} /> Add user
          </button>
        )}
      </div>
      <div className="chips">
        {(['all', 'online', 'pending', 'banned'] as Filter[]).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'online' ? 'Online' : f === 'pending' ? 'Not logged in' : 'Banned'} ({count(f)})
          </button>
        ))}
      </div>

      <ul className="emp-list">
        {users === null && <li className="muted">Loading…</li>}
        {users && !shown.length && <li className="muted">No users match.</li>}
        {shown.slice(0, limit).map((u) => (
          <li key={u.username} className={u.banned ? 'is-banned' : ''}>
            <div className="avatar-wrap">
              <Avatar name={u.username} size="sm" />
              {u.online && <span className="presence-dot" />}
            </div>
            <div className="grow">
              <div className="name">
                {u.name || shortId(u.username)} {u.name && <span className="muted small">@{shortId(u.username)}</span>}{' '}
                {u.username === me && <span className="muted small">(you)</span>} {u.admin && <span className="tag admin">{u.owner ? 'Main admin' : 'Admin'}</span>}{' '}
                {u.banned && <span className="tag banned">Banned</span>}{' '}
                {u.moved && <span className="tag">Moved</span>}{' '}
                {u.departments.map((d) => (
                  <span key={d} className="tag dept">
                    {d}
                  </span>
                ))}
              </div>
              {(u.phone || u.email) && (
                <div className="contact-line">
                  {u.phone && (
                    <span>
                      <Phone size={11} /> {u.phone}
                    </span>
                  )}
                  {u.email && (
                    <span>
                      <Mail size={11} /> {u.email}
                    </span>
                  )}
                </div>
              )}
              {editingProfile === u.username ? (
                <ProfileEditor
                  user={u}
                  onDone={(changed) => {
                    setEditingProfile(null);
                    if (changed) reload();
                  }}
                  onToast={onToast}
                />
              ) : editing === u.username ? (
                <DepartmentEditor
                  user={u}
                  departments={departments}
                  onDone={(changed) => {
                    setEditing(null);
                    if (changed) reload();
                  }}
                  onToast={onToast}
                />
              ) : (
                <div className="state">
                  {userState(u)}
                  {u.inviteExpires ? ` · QR waiting to be scanned (until ${new Date(u.inviteExpires).toLocaleDateString()})` : ''}
                </div>
              )}
            </div>
            <div className="row actions">
              {!u.moved && (
                <>
              <button className="icon" title="Edit profile: name, photo, mobile, email" onClick={() => setEditingProfile(u.username)}>
                <Pencil size={16} />
              </button>
              <button className="icon" title="Change departments" onClick={() => setEditing(u.username)}>
                <Building2 size={16} />
              </button>
              {u.username !== me && (
                <>
                  {u.active && !u.banned && (
                    <button className="icon" title="Message" onClick={() => openChat(u.username)}>
                      <MessageSquare size={16} />
                    </button>
                  )}
                  <button className="icon" title="New invite: QR, email or password (new phone or forgotten password)" onClick={() => void newQr(u)}>
                    <QrCode size={16} />
                  </button>
                  {!u.banned && !(u.owner && !iAmOwner) && (
                    <button className={`icon ${u.admin ? 'active' : ''}`} title={u.admin ? 'Remove admin' : 'Make admin'} onClick={() => toggleAdmin(u)}>
                      <ShieldCheck size={16} />
                    </button>
                  )}
                  {!u.admin && (
                    <button className={`icon ${u.banned ? '' : 'warn'}`} title={u.banned ? 'Unblock' : 'Block (signs them out)'} onClick={() => void ban(u)}>
                      {u.banned ? <CircleCheck size={16} /> : <Ban size={16} />}
                    </button>
                  )}
                </>
              )}
                </>
              )}
              {u.username !== me && !(u.owner && !iAmOwner) && (
                <button className="icon danger" title="Delete" onClick={() => remove(u.username)}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {shown.length > limit && (
        <button onClick={() => setLimit((n) => n + 100)} style={{ marginTop: 8 }}>
          Show more ({shown.length - limit})
        </button>
      )}
    </>
  );
}

/** Tick any number of departments from the admin's list (none ticked = no department). */
function DepartmentPicker({
  value,
  onChange,
  departments,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  departments: string[];
}) {
  const toggle = (d: string) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d]);
  if (!departments.length) return <span className="muted small">No departments yet</span>;
  return (
    <div className="chips dept-picker" role="group" aria-label="Departments">
      {departments.map((d) => (
        <button
          key={d}
          type="button"
          className={value.includes(d) ? 'active' : ''}
          aria-pressed={value.includes(d)}
          onClick={() => toggle(d)}
        >
          {value.includes(d) && <Check size={13} />} {d}
        </button>
      ))}
    </div>
  );
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

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
  const [value, setValue] = useState(user.departments);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (sameList(value, user.departments)) return onDone(false);
    setBusy(true);
    try {
      await client.setDepartments(user.username, value);
      onToast(value.length ? `${user.username}: ${[...value].sort().join(', ')}` : `${user.username} has no department now`);
      onDone(true);
    } catch (err) {
      onToast(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="row dept-edit" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), onDone(false))}>
      <DepartmentPicker value={value} onChange={setValue} departments={departments} />
      <button className="primary" disabled={busy}>
        Save
      </button>
      <button type="button" onClick={() => onDone(false)}>
        Cancel
      </button>
    </form>
  );
}

function CreateUser({
  departments,
  initialDepartment,
  onManageDepartments,
  onCancel,
  onCreated,
}: {
  departments: string[];
  initialDepartment: string;
  onManageDepartments: () => void;
  onCancel: () => void;
  onCreated: (s: Share) => void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [photo, setPhoto] = useState<{ mime: string; data: string } | null>(null);
  const [picked, setPicked] = useState<string[]>(initialDepartment ? [initialDepartment] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const username = id.trim().toLowerCase();
    if (!ID_RE.test(username)) return setError('ID: 3-32 characters, a-z 0-9 _ .');
    if (!name.trim()) return setError('Enter their full name');
    setBusy(true);
    try {
      const invite = await client.inviteEmployee({
        username,
        name,
        phone,
        email,
        departments: picked,
        photo: photo ?? undefined,
      });
      onCreated({ invite, name: name.trim(), email: email.trim() || undefined, renewed: false });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="panel">
      <div className="section-title" style={{ marginTop: 0 }}>
        Add user
      </div>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        Fill in their profile. You get a QR code: they scan it in the CellMate app and only choose a password. They can't change
        their name, photo, mobile or email; only you can.
      </p>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <PhotoPicker value={photo} onChange={setPhoto} onError={setError} />
        <div className="grow stack" style={{ gap: 8 }}>
          <div className="row">
            <input value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} placeholder="Full name, e.g. Ravi Kumar" autoFocus />
            <input value={id} onChange={(e) => setId(e.target.value.toLowerCase())} placeholder="User ID, e.g. ravi.k" />
          </div>
          <div className="row">
            <input value={phone} maxLength={MAX_PHONE} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile, e.g. +91 98765 43210" type="tel" />
            <input value={email} maxLength={MAX_EMAIL} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10, alignItems: 'flex-start' }}>
        <Building2 size={17} color="var(--faint)" style={{ marginTop: 6, flexShrink: 0 }} />
        <DepartmentPicker value={picked} onChange={setPicked} departments={departments} />
        <button type="button" className="link-btn" onClick={onManageDepartments}>
          {departments.length ? 'Manage departments' : 'Add departments first'}
        </button>
      </div>
      {error && (
        <div className="error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
      <div className="row-end" style={{ marginTop: 12 }}>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy || id.length < 3 || !name.trim()}>
          <UserPlus size={16} /> Create & show QR
        </button>
      </div>
    </form>
  );
}

/** Pick a profile photo (shrunk to a 400 px JPEG so it loads fast everywhere). */
function PhotoPicker({
  value,
  current,
  onChange,
  onError,
}: {
  value: { mime: string; data: string } | null;
  /** The user's current photo (data: URL), shown until a new one is picked. */
  current?: string;
  onChange: (p: { mime: string; data: string } | null) => void;
  onError: (m: string) => void;
}) {
  async function pick(f: File | undefined) {
    if (!f) return;
    try {
      onChange({ mime: 'image/jpeg', data: toBase64(await shrinkPhoto(f)) });
    } catch (e) {
      onError(errorText(e));
    }
  }
  const src = value ? `data:${value.mime};base64,${value.data}` : current;
  return (
    <label className="photo-pick" title="Profile photo">
      {src ? <img src={src} alt="" draggable={false} /> : <Camera size={22} />}
      <span>{src ? 'Change' : 'Photo'}</span>
      <input type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
    </label>
  );
}

/** Shrink a picked photo to a JPEG of at most 400 px. */
async function shrinkPhoto(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not read that picture');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The QR invite to show the new user, plus ways to send it: email (opens the mail app with the instructions),
 * copy the code, save the QR picture, or give a temporary password with company code + ID instead.
 */
function InviteView({ share, onDone, onToast }: { share: Share; onDone: () => void; onToast: Toast }) {
  // The address the person's phone uses to reach the server (on this PC it may be "localhost", which a phone
  // can't reach, so the admin can change it here).
  const [server, setServer] = useState(client.account?.serverUrl ?? '');
  const [qr, setQr] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const code = inviteCode(server || 'http://localhost', share.invite);
  useEffect(() => {
    QRCode.toDataURL(code, { margin: 1, width: 260, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(null));
  }, [code]);
  const local = /^https?:\/\/(localhost|127\.)/i.test(server);
  const username = share.invite.username;
  const msg = temp ? passwordMessage(share.name, companyOf(username), shortId(username), temp) : inviteMessage(share.name, code, server);
  const mailto = `mailto:${encodeURIComponent(share.email ?? '')}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body)}`;
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => onToast(`${what} copied`),
      () => onToast('Could not copy'),
    );
  async function usePassword() {
    setBusy(true);
    try {
      const pw = generatePassword();
      await client.resetEmployeePassword(username, pw);
      setTemp(pw);
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveQr() {
    if (!qr) return;
    const data = new Uint8Array(await (await fetch(qr)).arrayBuffer());
    if (window.meetme.saveFile) {
      const where = await window.meetme.saveFile(`cellmate-invite-${shortId(username)}.png`, data);
      if (where) onToast(`Saved to ${where}`);
    } else {
      const a = document.createElement('a');
      a.href = qr;
      a.download = `cellmate-invite-${shortId(username)}.png`;
      a.click();
    }
  }

  return (
    <div className="share stack panel invite">
      <div className="ok">
        <Check size={16} />
        {share.renewed ? `New invite for ${share.name}` : `${share.name} created`}.{' '}
        {temp ? 'They sign in with these details, then choose their own password.' : 'They scan this QR in the CellMate app and choose a password.'}
      </div>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        {temp ? (
          <div className="qr-box temp-login">
            {companyOf(username) && (
              <div>
                Company code <strong>{companyOf(username)}</strong>
              </div>
            )}
            <div>
              ID <strong>{shortId(username)}</strong>
            </div>
            <div>
              Temporary password <code>{temp}</code>
            </div>
          </div>
        ) : (
          <div className="qr-box">{qr ? <img src={qr} alt="QR invite" draggable={false} /> : <Loader2 className="spin" />}</div>
        )}
        <div className="grow stack" style={{ gap: 8 }}>
          {local && (
            <>
              <label className="field-label">
                Server address in the QR
                <input value={server} onChange={(e) => setServer(e.target.value)} />
              </label>
              <div className="notice">
                A phone can't reach "localhost". Use this PC's network address (e.g. http://192.168.0.155:8080), or your real server address.
              </div>
            </>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            {temp
              ? 'Send these privately. The temporary password stops working once they choose their own.'
              : `Works once, until ${new Date(share.invite.expires).toLocaleString()}. Anyone with it can set up the account, so show it in person or send it privately. On a computer they paste the invite code.`}
          </p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <a className={`button ${share.email ? 'primary' : ''}`} href={mailto}>
              <Mail size={16} /> {share.email ? `Email to ${share.email}` : 'Email'}
            </a>
            <button onClick={() => void copy(msg.body, temp ? 'Sign-in details' : 'Invite message')}>
              <Copy size={16} /> Copy message
            </button>
            {!temp && (
              <>
                <button onClick={() => void copy(code, 'Invite code')}>
                  <Copy size={16} /> Copy code
                </button>
                <button onClick={() => void saveQr()} disabled={!qr}>
                  <QrCode size={16} /> Save QR picture
                </button>
                <button onClick={() => void usePassword()} disabled={busy}>
                  <KeyRound size={16} /> Give ID + password instead
                </button>
              </>
            )}
            <div className="grow" />
            <button className="primary" onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
/** Admin: change a user's name, photo, mobile and email (users can't change these themselves). */
function ProfileEditor({ user, onDone, onToast }: { user: AdminUser; onDone: (changed: boolean) => void; onToast: Toast }) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [email, setEmail] = useState(user.email);
  /** undefined = keep, null = remove */
  const [photo, setPhoto] = useState<{ mime: string; data: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const current = photo === null ? undefined : client.avatarOf(user.username);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await client.setEmployeeProfile(user.username, { name, phone, email });
      if (photo !== undefined) {
        await client.setEmployeeAvatar(user.username, photo && { mime: photo.mime, data: fromBase64(photo.data) });
      }
      onToast(`Saved ${name || user.username}'s profile`);
      onDone(true);
    } catch (err) {
      onToast(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="profile-edit" onSubmit={save}>
      <PhotoPicker value={photo ?? null} current={current} onChange={setPhoto} onError={onToast} />
      <div className="grow stack" style={{ gap: 6 }}>
        <input value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} placeholder="Full name" autoFocus />
        <div className="row">
          <input value={phone} maxLength={MAX_PHONE} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile" type="tel" />
          <input value={email} maxLength={MAX_EMAIL} onChange={(e) => setEmail(e.target.value)} placeholder="Email" type="email" />
        </div>
        <div className="row">
          {(current || photo) && (
            <button type="button" className="link-btn" onClick={() => setPhoto(null)}>
              Remove photo
            </button>
          )}
          <div className="grow" />
          <button type="button" onClick={() => onDone(false)}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </div>
    </form>
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

  async function add(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n && (await run(() => client.addDepartment(n), `Department "${n}" added`))) setName('');
  }

  async function rename(e: FormEvent, from: string) {
    e.preventDefault();
    const to = newName.trim();
    if (!to || to === from) return setRenaming(null);
    if (await run(() => client.renameDepartment(from, to), `"${from}" renamed to "${to}"`)) setRenaming(null);
  }

  const remove = (d: string) => {
    const n = members(d);
    const who = n ? ` It is taken off its ${n} member${n === 1 ? '' : 's'} (their other departments stay).` : '';
    if (confirm(`Delete the department "${d}"?${who}`)) void run(() => client.deleteDepartment(d), `Department "${d}" deleted`);
  };

  return (
    <>
      <form className="row" style={{ marginTop: 4 }} onSubmit={add}>
        <input
          className="grow"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_DEPARTMENT}
          placeholder="New department, e.g. Sales"
        />
        <button className="primary" disabled={busy || !name.trim()}>
          <Plus size={16} /> Add department
        </button>
      </form>
      <p className="muted small" style={{ margin: '10px 0' }}>
        Put each user in one or more departments, filter users by them, and send announcements to chosen departments only.
      </p>
      <ul className="emp-list">
        {departments === null && <li className="muted">Loading…</li>}
        {departments && !departments.length && <li className="muted">No departments yet. Add your first one above.</li>}
        {(departments ?? []).map((d) => (
          <li key={d}>
            <div className="avatar sm group-avatar">
              <Building2 size={16} />
            </div>
            <div className="grow">
              {renaming === d ? (
                <form className="row dept-edit" style={{ marginTop: 0 }} onSubmit={(e) => void rename(e, d)}>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setRenaming(null))}
                    maxLength={MAX_DEPARTMENT}
                    autoFocus
                  />
                  <button className="primary" disabled={busy}>
                    Save
                  </button>
                  <button type="button" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div className="name">{d}</div>
                  <div className="state">
                    {members(d)} member{members(d) === 1 ? '' : 's'}
                  </div>
                </>
              )}
            </div>
            {renaming !== d && (
              <div className="row actions">
                <button
                  className="icon"
                  title="Rename"
                  onClick={() => {
                    setRenaming(d);
                    setNewName(d);
                  }}
                >
                  <Pencil size={16} />
                </button>
                <button className="icon danger" title="Delete" onClick={() => remove(d)}>
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
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

  const remove = async (g: GroupInfo) => {
    if (!confirm(`Delete the group "${g.name}"? Members can no longer write in it.`)) return;
    try {
      await client.deleteGroup(g.id);
      onToast(`Group "${g.name}" deleted`);
      reload();
    } catch (e) {
      onToast(errorText(e));
    }
  };

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

  const q = query.trim().toLowerCase();
  const shown = (groups ?? []).filter((g) => g.name.toLowerCase().includes(q) || g.members.some((m) => m.includes(q)));
  return (
    <>
      <div className="row" style={{ marginTop: 4 }}>
        <div className="search grow">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search groups or members" />
        </div>
        <button className="primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> New group
        </button>
      </div>
      <p className="muted small" style={{ margin: '10px 0' }}>
        Only admins create groups and choose who is in them. Group messages are end-to-end encrypted for every member.
      </p>
      <ul className="emp-list">
        {groups === null && <li className="muted">Loading…</li>}
        {groups && !shown.length && <li className="muted">{groups.length ? 'No groups match.' : 'No groups yet.'}</li>}
        {shown.map((g) => (
          <li key={g.id}>
            <div className="avatar sm group-avatar">
              <UsersRound size={16} />
            </div>
            <div className="grow">
              <div className="name">{g.name}</div>
              <div className="state" title={g.members.join(', ')}>
                {g.members.length} member{g.members.length === 1 ? '' : 's'}: {g.members.slice(0, 6).join(', ')}
                {g.members.length > 6 ? ', …' : ''}
                {g.senders ? ` · only ${g.senders.length ? g.senders.join(', ') : 'admins'} can send` : ''}
              </div>
            </div>
            <div className="row actions">
              {g.members.includes(me) && (
                <button className="icon" title="Open chat" onClick={() => openChat(groupKey(g.id))}>
                  <MessageSquare size={16} />
                </button>
              )}
              <button className="icon" title="Edit" onClick={() => setEditing(g)}>
                <Pencil size={16} />
              </button>
              <button className="icon danger" title="Delete" onClick={() => void remove(g)}>
                <Trash2 size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
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
  const me = client.account?.username ?? '';
  const [name, setName] = useState(group?.name ?? '');
  const [members, setMembers] = useState<Set<string>>(() => new Set(group?.members ?? [me]));
  // Who can send: everyone, or only the people ticked here (admins always can).
  const [restrict, setRestrict] = useState(!!group?.senders);
  const [senders, setSenders] = useState<Set<string>>(() => new Set(group?.senders ?? []));
  // Group admins: members who may manage the group themselves (members, who sends, its permissions).
  const [groupAdmins, setGroupAdmins] = useState<Set<string>>(() => new Set(group?.admins ?? []));
  // New groups: a normal group, or a channel (anyone may follow it, only its admins post).
  const [kind, setKind] = useState<'group' | 'channel'>(group?.kind === 'channel' ? 'channel' : 'group');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (u: string) =>
    setMembers((s) => {
      const n = new Set(s);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });

  const toggleSender = (u: string) =>
    setSenders((s) => {
      const n = new Set(s);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });
  const isAdminUser = (u: string) => users.some((x) => x.username === u && x.admin);
  // Admins can always send, so only the other members are offered as senders.
  const senderChoices = [...members].filter((u) => !isAdminUser(u)).sort();

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const list = [...members];
      const who = restrict ? [...senders].filter((u) => members.has(u)) : null;
      const g = group
        ? await client.updateGroup(group.id, { name: name.trim(), members: list, senders: who, admins: [...groupAdmins].filter((u) => members.has(u)) })
        : await client.createGroup(name.trim(), list, who, [...groupAdmins].filter((u) => members.has(u)), kind);
      onSaved(g);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const q = query.trim().toLowerCase();
  const shown = users.filter((u) => !u.moved && (shortId(u.username).includes(q) || u.name.toLowerCase().includes(q)));
  return (
    <form onSubmit={save} className="stack">
      <div className="section-title" style={{ marginTop: 4, marginBottom: 0 }}>
        {group ? 'Edit group' : 'New group'}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Group name" maxLength={MAX_GROUP_NAME} autoFocus />
      <div className="row">
        <div className="search grow">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find people" />
        </div>
        <span className="muted small">{members.size} selected</span>
      </div>
      <ul className="emp-list pick-list">
        {shown.map((u) => (
          <li key={u.username} onClick={() => toggle(u.username)}>
            <input type="checkbox" checked={members.has(u.username)} readOnly />
            <Avatar name={u.username} size="sm" />
            <div className="grow">
              <div className="name">
                {u.name || shortId(u.username)} {u.username === me && <span className="muted small">(you)</span>}
              </div>
              <div className="state">{userState(u)}</div>
            </div>
          </li>
        ))}
      </ul>
      {!group && (
        <div className="chips" style={{ margin: '4px 0 0' }}>
          <button type="button" className={kind === 'group' ? 'active' : ''} onClick={() => setKind('group')}>
            {kind === 'group' && <Check size={13} />} Group
          </button>
          <button type="button" className={kind === 'channel' ? 'active' : ''} onClick={() => setKind('channel')}>
            {kind === 'channel' && <Check size={13} />} Channel (anyone can follow, admins post)
          </button>
        </div>
      )}
      <div className="section-title" style={{ marginBottom: 0 }}>
        Who can send messages
      </div>
      <div className="chips" style={{ margin: '4px 0 0' }}>
        <button type="button" className={restrict ? '' : 'active'} onClick={() => setRestrict(false)}>
          {!restrict && <Check size={13} />} All members
        </button>
        <button type="button" className={restrict ? 'active' : ''} onClick={() => setRestrict(true)}>
          {restrict && <Check size={13} />} Only selected members
        </button>
      </div>
      {restrict && (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Tick who can send. Everyone else can only read. Admins can always send.
          </p>
          {senderChoices.length ? (
            <div className="chips" style={{ margin: 0 }}>
              {senderChoices.map((u) => (
                <button key={u} type="button" className={senders.has(u) ? 'active' : ''} onClick={() => toggleSender(u)}>
                  {senders.has(u) && <Check size={13} />} {shortId(u)}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              Add members above first.
            </p>
          )}
          {!senderChoices.some((u) => senders.has(u)) && senderChoices.length > 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              Nobody ticked: only admins can send (like an announcement group).
            </p>
          )}
        </>
      )}
      <div className="section-title" style={{ marginBottom: 0 }}>
        Group admins
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        They can add or remove members and set what members may do in this group.
      </p>
      {senderChoices.length ? (
        <div className="chips" style={{ margin: 0 }}>
          {senderChoices.map((u) => (
            <button
              key={u}
              type="button"
              className={groupAdmins.has(u) ? 'active' : ''}
              onClick={() =>
                setGroupAdmins((s) => {
                  const n = new Set(s);
                  if (n.has(u)) n.delete(u);
                  else n.add(u);
                  return n;
                })
              }
            >
              {groupAdmins.has(u) && <Check size={13} />} {shortId(u)}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Add members above first.
        </p>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row-end" style={{ marginTop: 4 }}>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy || !name.trim()}>
          <Check size={16} /> {group ? 'Save' : 'Create group'}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ activity log

function AuditList({ entries }: { entries: AuditEntry[] }) {
  return (
    <ul className="emp-list audit">
      {entries.map((e) => (
        <li key={e.id}>
          <div className="grow">
            <div>
              <strong>{e.actor}</strong> · {AUDIT_LABELS[e.action] ?? e.action} <strong>{e.target}</strong>
            </div>
            {e.detail && <div className="state">{e.detail}</div>}
          </div>
          <span className="muted small" title={new Date(e.ts).toLocaleString()}>
            {shortTime(e.ts)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The activity log, 50 at a time (newest first); "Load more" fetches the next page. */
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
    <>
      <div className="row" style={{ marginTop: 4, marginBottom: 12 }}>
        <div className="search grow">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the loaded entries" />
        </div>
        <button className="icon" title="Refresh" onClick={() => load(null)}>
          <RefreshCw size={16} />
        </button>
      </div>
      {entries === null ? (
        <p className="muted">Loading…</p>
      ) : shown.length ? (
        <AuditList entries={shown} />
      ) : (
        <p className="muted small">No admin actions logged{q ? ' that match' : ' yet'}.</p>
      )}
      {next !== null && (
        <button disabled={loading} onClick={() => load(next)} style={{ marginTop: 10 }}>
          {loading ? <Loader2 size={15} className="spin" /> : null} Load older entries
        </button>
      )}
      <p className="muted small">Every account, ban, group, permission and settings change is recorded here.</p>
    </>
  );
}
// ------------------------------------------------------------------ settings

function SettingsTab({ onToast }: { onToast: Toast }) {
  const c = useClient();
  const [busy, setBusy] = useState(false);
  const toggle = async (key: 'allowEditDelete' | 'allowClearHistory') => {
    setBusy(true);
    try {
      await client.setPolicy({ [key]: !c.policy[key] });
      onToast('Settings saved');
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="section-title" style={{ marginTop: 4 }}>
        Messages
      </div>
      <label className="setting">
        <div className="grow">
          <div className="name">Employees may edit and delete their messages</div>
          <div className="muted small">
            When off, only admins can edit or delete messages for everyone. Admins can always remove any message in
            chats they are part of.
          </div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={c.policy.allowEditDelete}
          disabled={busy}
          onChange={() => void toggle('allowEditDelete')}
        />
      </label>
      <label className="setting">
        <div className="grow">
          <div className="name">Employees may clear their chat history</div>
          <div className="muted small">
            Clear a chat, delete a message for themselves, and turn on disappearing messages. When off, employees can't
            remove any history. Admins always can.
          </div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={c.policy.allowClearHistory}
          disabled={busy}
          onChange={() => void toggle('allowClearHistory')}
        />
      </label>
      <div className="section-title">Accounts</div>
      <p className="muted small" style={{ margin: 0 }}>
        Only admins create accounts. Admins are set on the server with <code>ADMIN_USERS</code>. Banned users can't log
        in, send or receive until you unban them; their account and keys are kept.
      </p>
    </>
  );
}
