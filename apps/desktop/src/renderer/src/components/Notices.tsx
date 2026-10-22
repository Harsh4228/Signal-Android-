import { useEffect, useState } from 'react';
import { Bell, BellRing, Check, CheckCheck, Plus, Send, X } from 'lucide-react';
import {
  MAX_NOTICE_TITLE,
  departmentsOf,
  noticeAudience,
  type AdminUser,
  type GroupInfo,
  type Notice,
} from '@meetme/core';
import { client, useClient } from '../messenger';
import { errorText } from './ui';

const when = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Unread notices, shown one at a time over the whole app as soon as it opens (or a notice arrives).
 * The only way out is OK, which also tells the admin it was read.
 */
export function NoticePopup() {
  const c = useClient();
  const pending = c.pendingNotices();
  const [busy, setBusy] = useState(false);
  const n = pending[0];
  if (!n) return null;

  async function ok() {
    setBusy(true);
    try {
      await client.acknowledgeNotice(n!.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg notice-bg">
      <div className="modal notice-pop" role="alertdialog" aria-labelledby="notice-title">
        <header>
          <div className="title">
            <span className="title-icon">
              <BellRing size={18} />
            </span>
            <span>
              Notice
              {pending.length > 1 && <span className="muted small"> · 1 of {pending.length}</span>}
            </span>
          </div>
        </header>
        {n.title && (
          <h2 className="notice-title" id="notice-title">
            {n.title}
          </h2>
        )}
        {n.text && <div className="notice-text">{n.text}</div>}
        <p className="muted small notice-meta">
          From {n.from} · {when(n.ts)}
        </p>
        <button className="primary block" disabled={busy} onClick={ok} autoFocus>
          <Check size={16} /> OK
        </button>
      </div>
    </div>
  );
}

/** Every notice I received (and, for admins, sent), newest first. */
export function NoticesPanel({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [composing, setComposing] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = c.getNotices();

  if (composing) return <NewNotice onClose={() => setComposing(false)} onDone={onToast} />;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Bell size={18} />
            </span>
            Notices
          </div>
          <div className="row">
            {c.isAdmin && (
              <button className="primary" disabled={c.status !== 'online'} onClick={() => setComposing(true)}>
                <Plus size={16} /> New notice
              </button>
            )}
            <button className="icon" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </header>
        {list.length === 0 ? (
          <div className="notice-empty muted">
            <Bell size={28} color="var(--faint)" />
            <div>No notices yet</div>
            {c.isAdmin && <div className="small">Notices pop up on your employees' screens until they click OK.</div>}
          </div>
        ) : (
          <ul className="notice-list">
            {list.map((n) => (
              <NoticeItem key={`${n.from}:${n.id}`} n={n} open={open === n.id} onToggle={() => setOpen(open === n.id ? null : n.id)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NoticeItem({ n, open, onToggle }: { n: Notice; open: boolean; onToggle: () => void }) {
  const recipients = n.recipients ?? [];
  const readers = recipients.filter((u) => n.okBy?.[u]);
  const waiting = recipients.filter((u) => !n.okBy?.[u]);
  return (
    <li className="notice-item">
      <div className="row">
        <div className="grow">
          <div className="notice-item-title">{n.title || 'Notice'}</div>
          <div className="muted small">
            {n.outgoing ? `You → ${n.audience ?? 'Everyone'}` : `From ${n.from}`} · {when(n.ts)}
          </div>
        </div>
        {n.outgoing ? (
          <button className="read-count" onClick={onToggle} title="Who has read it">
            <CheckCheck size={14} /> Read by {readers.length} of {recipients.length}
          </button>
        ) : n.okAt ? (
          <span className="tag verified">
            <Check size={12} /> Read
          </span>
        ) : (
          <span className="tag dept">New</span>
        )}
      </div>
      {n.text && <div className="notice-text">{n.text}</div>}
      {n.outgoing && open && (
        <div className="read-by">
          <div>
            <div className="section-title">Read ({readers.length})</div>
            {readers.length ? (
              readers.map((u) => (
                <div key={u} className="small">
                  {u} <span className="muted">· {when(n.okBy![u]!)}</span>
                </div>
              ))
            ) : (
              <div className="muted small">Nobody yet</div>
            )}
          </div>
          <div>
            <div className="section-title">Not yet ({waiting.length})</div>
            {waiting.length ? (
              <div className="small">{waiting.join(', ')}</div>
            ) : (
              <div className="muted small">Everyone has read it</div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Admin: write a notice and pick who gets it (everyone, or any departments and groups). */
function NewNotice({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [departmentList, setDepartmentList] = useState<string[]>([]);
  const [depts, setDepts] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.listAllUsers().then(setUsers).catch(() => setUsers(null));
    client.listAllGroups().then(setGroups).catch(() => setGroups([]));
    client.listDepartments().then(setDepartmentList).catch(() => setDepartmentList([]));
  }, []);

  const me = client.account?.username;
  const target = { departments: depts, groups: groupIds };
  const recipients = noticeAudience(users ?? [], groups, target, me);
  const everyone = noticeAudience(users ?? [], groups, {}, me);
  const departments = [...new Set([...departmentList, ...departmentsOf(users ?? [])])].sort((a, b) => a.localeCompare(b));
  const picked = depts.length + groupIds.length;
  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const shownNames = recipients.slice(0, 8);

  async function send() {
    setBusy(true);
    try {
      const r = await client.sendNotice(title, text, target);
      onDone(
        r.failed.length
          ? `Notice sent to ${r.sent}. Failed: ${r.failed.join(', ')}`
          : `Notice sent to ${r.sent} employee${r.sent === 1 ? '' : 's'}`,
      );
      onClose();
    } catch (e) {
      onDone(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <BellRing size={18} />
            </span>
            New notice
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="section-title" style={{ marginTop: 0 }}>
          Send to
        </div>
        <div className="chips" style={{ marginTop: 6 }}>
          <button
            className={picked ? '' : 'active'}
            onClick={() => {
              setDepts([]);
              setGroupIds([]);
            }}
          >
            {!picked && <Check size={13} />} Everyone ({everyone.length})
          </button>
        </div>
        {departments.length > 0 && (
          <>
            <div className="muted small">Departments</div>
            <div className="chips" style={{ marginTop: 6 }}>
              {departments.map((d) => {
                const count = noticeAudience(users ?? [], [], { departments: [d] }, me).length;
                return (
                  <button
                    key={d}
                    className={depts.includes(d) ? 'active' : ''}
                    disabled={!count && !depts.includes(d)}
                    onClick={() => toggle(depts, setDepts, d)}
                  >
                    {depts.includes(d) && <Check size={13} />} {d} ({count})
                  </button>
                );
              })}
            </div>
          </>
        )}
        {groups.length > 0 && (
          <>
            <div className="muted small">Groups</div>
            <div className="chips" style={{ marginTop: 6 }}>
              {groups.map((g) => {
                const count = noticeAudience(users ?? [], [g], { groups: [g.id] }, me).length;
                return (
                  <button
                    key={g.id}
                    className={groupIds.includes(g.id) ? 'active' : ''}
                    disabled={!count && !groupIds.includes(g.id)}
                    onClick={() => toggle(groupIds, setGroupIds, g.id)}
                  >
                    {groupIds.includes(g.id) && <Check size={13} />} {g.name} ({count})
                  </button>
                );
              })}
            </div>
          </>
        )}
        <p className="intro">
          {users === null ? (
            'Loading employees…'
          ) : (
            <>
              Goes to <strong>{recipients.length}</strong> employee{recipients.length === 1 ? '' : 's'}
              {recipients.length > 0 && (
                <span className="muted">
                  {': '}
                  {shownNames.join(', ')}
                  {recipients.length > shownNames.length ? ` and ${recipients.length - shownNames.length} more` : ''}
                </span>
              )}
              .
            </>
          )}{' '}
          It pops up on their screen until they click OK, and you can see who has read it.
        </p>
        <div className="stack">
          <input
            value={title}
            maxLength={MAX_NOTICE_TITLE}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title, e.g. Office closed on Friday"
            autoFocus
          />
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write the notice…" />
        </div>
        <div className="row-end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || (!title.trim() && !text.trim()) || !recipients.length} onClick={send}>
            <Send size={16} />
            {busy ? 'Sending…' : 'Send notice'}
          </button>
        </div>
      </div>
    </div>
  );
}
