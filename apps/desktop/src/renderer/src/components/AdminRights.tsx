import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Clock, LifeBuoy, Mail, MessageSquare, Pencil, Phone, Plus, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  FEATURES,
  FEATURE_KEYS,
  MAX_EMAIL,
  MAX_HELP_FIELD,
  MAX_PHONE,
  shortId,
  type AdminUser,
  type Feature,
  type GroupInfo,
  type HelpContact,
  type HelpContactInput,
  type RightRule,
  type RightScope,
} from '@meetme/core';
import { client } from '../messenger';
import { Avatar, errorText } from './ui';

type Toast = (m: string) => void;
const SCOPE_LABEL: Record<RightScope, string> = { company: 'Everyone', department: 'Department', group: 'Group', user: 'Person' };
const companyAllows = (rules: RightRule[], f: Feature) => rules.find((r) => r.feature === f && r.scope === 'company')?.allow ?? FEATURES[f].default;

function StatePill({ allow, onClick }: { allow: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`state-pill ${allow ? 'allow' : 'block'}`} onClick={onClick} disabled={!onClick} title={onClick ? 'Switch' : undefined}>
      {allow ? 'Allowed' : 'Blocked'}
    </button>
  );
}

/** Back to what applies above / allow / block. */
function Choice({ value, onChange, inherit }: { value: boolean | null; onChange: (v: boolean | null) => void; inherit: string }) {
  const items: [boolean | null, string, string][] = [
    [null, inherit, ''],
    [true, 'Allow', 'allow'],
    [false, 'Block', 'block'],
  ];
  return (
    <div className="seg">
      {items.map(([v, label, cls]) => (
        <button key={label} type="button" className={`${cls} ${value === v ? 'active' : ''}`} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Company admin: who may use each protected function (everyone, plus exceptions). */
export function RightsTab({
  users,
  groups,
  departments,
  onToast,
}: {
  users: AdminUser[] | null;
  groups: GroupInfo[] | null;
  departments: string[];
  onToast: Toast;
}) {
  const [rules, setRules] = useState<RightRule[] | null>(null);
  const [open, setOpen] = useState<Feature | null>(null);
  useEffect(() => {
    client.getRightRules().then(setRules, (e) => onToast(errorText(e)));
  }, [onToast]);
  if (!rules) return <p className="muted">Loading…</p>;
  if (open) {
    return (
      <FeatureRules
        feature={open}
        rules={rules}
        users={users ?? []}
        groups={groups ?? []}
        departments={departments}
        onRules={setRules}
        onBack={() => setOpen(null)}
        onToast={onToast}
      />
    );
  }
  return (
    <>
      <p className="muted small" style={{ marginTop: 4 }}>
        <ShieldCheck size={14} /> Decide who may use each function: set it for everyone, then make exceptions for a department, a
        group or a person. The most specific setting wins. Admins can always use everything.
      </p>
      <ul className="emp-list">
        {FEATURE_KEYS.map((f) => {
          const n = rules.filter((r) => r.feature === f && r.scope !== 'company').length;
          return (
            <li key={f} className="clickable" onClick={() => setOpen(f)}>
              <div className="grow">
                <div className="name">{FEATURES[f].label}</div>
                <div className="state">
                  {FEATURES[f].hint} · {companyAllows(rules, f) ? 'everyone' : 'nobody'}
                  {n ? ` · ${n} exception${n > 1 ? 's' : ''}` : ''}
                </div>
              </div>
              <StatePill allow={companyAllows(rules, f)} />
              <ChevronRight size={16} className="muted" />
            </li>
          );
        })}
      </ul>
    </>
  );
}

function FeatureRules({
  feature,
  rules,
  users,
  groups,
  departments,
  onRules,
  onBack,
  onToast,
}: {
  feature: Feature;
  rules: RightRule[];
  users: AdminUser[];
  groups: GroupInfo[];
  departments: string[];
  onRules: (r: RightRule[]) => void;
  onBack: () => void;
  onToast: Toast;
}) {
  const [busy, setBusy] = useState(false);
  // Exceptions for several at once; 'member' = chosen people inside one group (only there).
  const [scope, setScope] = useState<'department' | 'group' | 'user' | 'member'>('user');
  const [picked, setPicked] = useState<string[]>([]);
  const [inGroup, setInGroup] = useState('');
  const [query, setQuery] = useState('');
  const everyone = companyAllows(rules, feature);
  const mine = rules.filter((r) => r.feature === feature && r.scope !== 'company');
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? 'Group';
  const personName = (u: string) => users.find((x) => x.username === u)?.name || shortId(u);
  const label = (r: RightRule) =>
    r.scope === 'department' ? r.target : r.scope === 'group' ? (r.member ? `${personName(r.member)} in ${groupName(r.target)}` : groupName(r.target)) : personName(r.target);

  async function change(sc: RightScope, tg: string, allow: boolean | null, member = '') {
    setBusy(true);
    try {
      onRules(await client.setRight({ feature, scope: sc, target: tg, member, allow }));
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const nameOf = (u: string) => {
    const x = users.find((p) => p.username === u);
    return x?.name ? `${x.name} (${shortId(u)})` : shortId(u);
  };
  const choosingGroup = scope === 'member' && !inGroup;
  const options: [string, string][] =
    scope === 'department'
      ? departments.map((d) => [d, d])
      : scope === 'group' || choosingGroup
        ? groups.map((g) => [g.id, g.name])
        : scope === 'member'
          ? (groups.find((g) => g.id === inGroup)?.members ?? []).filter((u) => !users.find((p) => p.username === u)?.admin).map((u) => [u, nameOf(u)])
          : users.filter((u) => !u.admin && !u.moved).map((u) => [u.username, nameOf(u.username)]);
  const toggle = (id: string) => (choosingGroup ? setInGroup(id) : setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])));
  async function addAll(allow: boolean) {
    for (const id of picked) await (scope === 'member' ? change('group', inGroup, allow, id) : change(scope, id, allow));
    setPicked([]);
  }
  const q = query.trim().toLowerCase();

  return (
    <>
      <div className="row" style={{ marginTop: 4, gap: 8 }}>
        <button className="icon" title="Back" onClick={onBack}>
          <ChevronLeft size={18} />
        </button>
        <h3 style={{ margin: 0 }}>{FEATURES[feature].label}</h3>
      </div>
      <p className="muted small">{FEATURES[feature].hint}.</p>
      <label className="setting">
        <div className="grow">
          <div className="name">Everyone in the company</div>
          <div className="muted small">{everyone ? 'Allowed, except the blocks below' : 'Blocked, except the ones allowed below'}</div>
        </div>
        <input type="checkbox" className="switch" checked={everyone} disabled={busy} onChange={() => void change('company', '', !everyone)} />
      </label>
      <div className="section-title">Exceptions</div>
      {!mine.length && <p className="muted small">None: everyone follows the setting above.</p>}
      {!!mine.length && (
        <ul className="emp-list">
          {mine.map((r) => (
            <li key={`${r.scope}:${r.target}:${r.member}`}>
              <div className="grow">
                <div className="name">{label(r)}</div>
                <div className="state">{r.member ? 'Person in a group' : SCOPE_LABEL[r.scope]}</div>
              </div>
              <StatePill allow={r.allow} onClick={busy ? undefined : () => void change(r.scope, r.target, !r.allow, r.member)} />
              <button className="icon danger-text" title="Remove exception" onClick={() => void change(r.scope, r.target, null, r.member)}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="section-title">Add exception</div>
      <div className="seg" style={{ marginBottom: 8 }}>
        {(
          [
            ['user', 'Person'],
            ['department', 'Department'],
            ['group', 'Group'],
            ['member', 'Person in a group'],
          ] as const
        ).map(([sc, l]) => (
          <button
            key={sc}
            type="button"
            className={scope === sc ? 'active' : ''}
            onClick={() => {
              setScope(sc);
              setPicked([]);
              setInGroup('');
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {scope === 'member' && (
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          {inGroup ? (
            <>
              People in <strong>{groups.find((g) => g.id === inGroup)?.name}</strong>: they get this only inside that group.{' '}
              <button type="button" className="link" onClick={() => (setInGroup(''), setPicked([]))}>
                Choose another group
              </button>
            </>
          ) : (
            'First choose the group:'
          )}
        </p>
      )}
      <div className="search" style={{ marginBottom: 8 }}>
        <Search size={16} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
      </div>
      <div className="choose-list">
        {options
          .filter(([, l]) => l.toLowerCase().includes(q))
          .slice(0, 80)
          .map(([id, l]) => (
            <button key={id} type="button" className={picked.includes(id) ? 'active' : ''} onClick={() => toggle(id)}>
              {picked.includes(id) && <Check size={13} />} {l}
            </button>
          ))}
        {!options.length && <p className="muted small">Nothing to choose{scope === 'department' ? ': add departments first' : ''}.</p>}
      </div>
      {!choosingGroup && (
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="primary" disabled={!picked.length || busy} onClick={() => void addAll(true)}>
            Allow{picked.length > 1 ? ` for ${picked.length}` : ''}
          </button>
          <button className="danger" disabled={!picked.length || busy} onClick={() => void addAll(false)}>
            Block{picked.length > 1 ? ` for ${picked.length}` : ''}
          </button>
        </div>
      )}    </>
  );
}

/** A group's own rights (its group admins and the company admins). They apply only in this group's chat. */
export function GroupRightsModal({ group, onClose, onToast }: { group: GroupInfo; onClose: () => void; onToast: Toast }) {
  const [rules, setRules] = useState<RightRule[] | null>(null);
  const [open, setOpen] = useState<Feature | null>(null);
  useEffect(() => {
    client.getRightRules(group.id).then(setRules, (e) => onToast(errorText(e)));
  }, [group.id, onToast]);
  const change = async (feature: Feature, allow: boolean | null, member = '') => {
    try {
      setRules(await client.setRight({ feature, scope: 'group', target: group.id, member, allow }));
    } catch (e) {
      onToast(errorText(e));
    }
  };
  const forAll = (f: Feature) => rules?.find((r) => r.feature === f && !r.member)?.allow ?? null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            {open && (
              <button className="icon" title="Back" onClick={() => setOpen(null)}>
                <ChevronLeft size={18} />
              </button>
            )}
            Group permissions · {group.name}
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body">
          {!rules ? (
            <p className="muted">Loading…</p>
          ) : open ? (
            <>
              <h3 style={{ marginTop: 0 }}>{FEATURES[open].label}</h3>
              <p className="muted small">{FEATURES[open].hint}, in this group.</p>
              <div className="section-title">Everyone in the group</div>
              <Choice value={forAll(open)} onChange={(v) => void change(open, v)} inherit="Company setting" />
              <div className="section-title">Members</div>
              <ul className="emp-list">
                {group.members
                  .filter((u) => u !== client.account?.username)
                  .map((u) => (
                    <li key={u}>
                      <Avatar name={u} />
                      <div className="grow name">{client.displayName(u)}</div>
                      <Choice value={rules.find((r) => r.feature === open && r.member === u)?.allow ?? null} onChange={(v) => void change(open, v, u)} inherit="As group" />
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <>
              <p className="muted small" style={{ marginTop: 0 }}>
                Allow or block functions inside this group's chat, for everyone in it or for single members. Outside the group the
                company settings apply.
              </p>
              <ul className="emp-list">
                {FEATURE_KEYS.map((f) => {
                  const all = forAll(f);
                  const n = rules.filter((r) => r.feature === f && r.member).length;
                  return (
                    <li key={f} className="clickable" onClick={() => setOpen(f)}>
                      <div className="grow">
                        <div className="name">{FEATURES[f].label}</div>
                        <div className="state">
                          {all === null ? 'Company setting' : all ? 'Allowed in this group' : 'Blocked in this group'}
                          {n ? ` · ${n} member${n > 1 ? 's' : ''}` : ''}
                        </div>
                      </div>
                      {all !== null && <StatePill allow={all} />}
                      <ChevronRight size={16} className="muted" />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ help desk

type Draft = HelpContactInput & { id?: string };
const EMPTY: Draft = { title: '', name: '', department: '', phone: '', email: '', hours: '', username: '' };

function ContactCard({ c, onChat }: { c: HelpContact; onChat?: (u: string) => void }) {
  return (
    <div className="help-card">
      <div className="row" style={{ gap: 10 }}>
        {c.username ? (
          <Avatar name={c.username} />
        ) : (
          <span className="title-icon">
            <LifeBuoy size={18} />
          </span>
        )}
        <div className="grow">
          <div className="name">{c.title}</div>
          {(c.name || c.department) && <div className="muted small">{[c.name, c.department && `for ${c.department}`].filter(Boolean).join(' · ')}</div>}
        </div>
      </div>
      {c.hours && (
        <div className="muted small">
          <Clock size={12} /> {c.hours}
        </div>
      )}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {c.phone && (
          <a className="button" href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>
            <Phone size={14} /> {c.phone}
          </a>
        )}
        {c.email && (
          <a className="button" href={`mailto:${c.email}`}>
            <Mail size={14} /> {c.email}
          </a>
        )}
        {c.username && onChat && c.username !== client.account?.username && (
          <button onClick={() => onChat(c.username)}>
            <MessageSquare size={14} /> Chat
          </button>
        )}
      </div>
    </div>
  );
}

/** Everyone: whom to contact for help, as the company admin set it up. */
export function HelpDeskModal({ onClose, onToast }: { onClose: () => void; onToast: Toast }) {
  const [contacts, setContacts] = useState<HelpContact[] | null>(null);
  const [query, setQuery] = useState('');
  useEffect(() => {
    client.getHelpDesk().then(setContacts, (e) => (onToast(errorText(e)), setContacts([])));
  }, [onToast]);
  const chat = (u: string) =>
    void client.addContact(u).then(
      () => (client.setActiveChat(u), onClose()),
      (e) => onToast(errorText(e)),
    );
  const q = query.trim().toLowerCase();
  const shown = (contacts ?? []).filter((c) => `${c.title} ${c.name} ${c.department} ${c.phone} ${c.email}`.toLowerCase().includes(q));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <LifeBuoy size={18} />
            </span>
            Help desk
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body">
          {(contacts?.length ?? 0) > 5 && (
            <div className="search" style={{ marginBottom: 10 }}>
              <Search size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: IT, HR, a name…" autoFocus />
            </div>
          )}
          {contacts === null && <p className="muted">Loading…</p>}
          {contacts?.length === 0 && <p className="muted">Your admin hasn't added any help contacts yet.</p>}
          <div className="help-list">
            {shown.map((c) => (
              <ContactCard key={c.id} c={c} onChat={chat} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Company admin: keep the help desk list. */
export function HelpDeskTab({ users, departments, onToast }: { users: AdminUser[] | null; departments: string[]; onToast: Toast }) {
  const [contacts, setContacts] = useState<HelpContact[] | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    client.getHelpDesk().then(setContacts, (e) => onToast(errorText(e)));
  }, [onToast]);
  useEffect(load, [load]);
  async function save(list: Draft[], msg: string) {
    setBusy(true);
    try {
      setContacts(await client.setHelpDesk(list));
      setEditing(null);
      onToast(msg);
    } catch (e) {
      onToast(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const move = (i: number, d: -1 | 1) => {
    const list = [...(contacts ?? [])];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    void save(list, 'Order saved');
  };
  if (editing) {
    const d = editing;
    const set = (k: keyof Draft) => (e: { target: { value: string } }) => setEditing({ ...d, [k]: e.target.value });
    return (
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const list: Draft[] = contacts ?? [];
          void save(d.id ? list.map((c) => (c.id === d.id ? d : c)) : [...list, d], `Saved "${d.title}"`);
        }}
      >
        <h3 style={{ margin: '4px 0' }}>{d.id ? 'Edit contact' : 'New contact'}</h3>
        <label>
          Title
          <input value={d.title} onChange={set('title')} placeholder="e.g. IT support, HR, Accounts" maxLength={MAX_HELP_FIELD} autoFocus required />
        </label>
        <label>
          Name or team
          <input value={d.name} onChange={set('name')} placeholder="e.g. Sunil Mehta" maxLength={MAX_HELP_FIELD} />
        </label>
        <label>
          For department
          <select value={d.department} onChange={set('department')}>
            <option value="">Everyone</option>
            {departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label>
          Mobile
          <input value={d.phone} onChange={set('phone')} maxLength={MAX_PHONE} inputMode="tel" />
        </label>
        <label>
          Email
          <input value={d.email} onChange={set('email')} maxLength={MAX_EMAIL} type="email" />
        </label>
        <label>
          Hours
          <input value={d.hours} onChange={set('hours')} placeholder="e.g. Mon-Fri 9:00-18:00" maxLength={MAX_HELP_FIELD} />
        </label>
        <label>
          Chat in CellMate (optional)
          <select
            value={d.username}
            onChange={(e) => {
              const u = (users ?? []).find((x) => x.username === e.target.value);
              setEditing({ ...d, username: e.target.value, name: d.name || u?.name || '', phone: d.phone || u?.phone || '', email: d.email || u?.email || '' });
            }}
          >
            <option value="">Nobody</option>
            {(users ?? [])
              .filter((u) => u.active && !u.banned && !u.moved)
              .map((u) => (
                <option key={u.username} value={u.username}>
                  {u.name || shortId(u.username)}
                </option>
              ))}
          </select>
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" onClick={() => setEditing(null)}>
            Cancel
          </button>
          <button className="primary" disabled={busy || !d.title.trim()}>
            Save
          </button>
        </div>
      </form>
    );
  }
  return (
    <>
      <p className="muted small" style={{ marginTop: 4 }}>
        <LifeBuoy size={14} /> Contacts everyone can open from the help icon: IT, HR, accounts, a manager per department… with mobile,
        email and hours.
      </p>
      {contacts === null && <p className="muted">Loading…</p>}
      <ul className="emp-list">
        {contacts?.map((c, i) => (
          <li key={c.id}>
            <div className="grow">
              <div className="name">{c.title}</div>
              <div className="state">{[c.name, c.department, c.phone, c.email].filter(Boolean).join(' · ') || 'No details yet'}</div>
            </div>
            <button className="icon" title="Move up" onClick={() => move(i, -1)}>
              <ArrowUp size={15} />
            </button>
            <button className="icon" title="Move down" onClick={() => move(i, 1)}>
              <ArrowDown size={15} />
            </button>
            <button className="icon" title="Edit" onClick={() => setEditing(c)}>
              <Pencil size={15} />
            </button>
            <button className="icon danger-text" title="Remove" onClick={() => void save((contacts ?? []).filter((x) => x.id !== c.id), `Removed "${c.title}"`)}>
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      <button className="primary" onClick={() => setEditing({ ...EMPTY })}>
        <Plus size={16} /> Add contact
      </button>
    </>
  );
}
