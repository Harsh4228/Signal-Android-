import { useEffect, useState } from 'react';
import { Check, Megaphone, Paperclip, Send, X } from 'lucide-react';
import { departmentsOf, formatBytes, type AdminUser, type OutgoingFile } from '@meetme/core';
import { client } from '../messenger';
import { errorText } from './ui';

export function Broadcast({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [text, setText] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  /** Empty = everyone. */
  const [only, setOnly] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<OutgoingFile | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFile({ name: f.name, mime: f.type || 'application/octet-stream', data: new Uint8Array(await f.arrayBuffer()) });
  }

  const [departmentList, setDepartmentList] = useState<string[]>([]);

  useEffect(() => {
    client
      .listAllUsers()
      .then(setUsers)
      .catch(() => setUsers(null));
    client
      .listDepartments()
      .then(setDepartmentList)
      .catch(() => setDepartmentList([]));
  }, []);

  // Same rule as client.listActiveRecipients: logged in at least once, not banned, not me.
  const reachable = (users ?? []).filter((u) => u.active && !u.banned && u.username !== client.account?.username);
  // Every department the admin made (plus any still on a user), even empty ones, so the choice is always there.
  const departments = [...new Set([...departmentList, ...departmentsOf(reachable)])].sort((a, b) => a.localeCompare(b));
  const inDept = (d: string) => reachable.filter((u) => u.departments.includes(d)).length;
  // Someone in several of the chosen departments still counts (and gets the message) once.
  const recipients = only.length ? reachable.filter((u) => u.departments.some((d) => only.includes(d))) : reachable;
  const count = recipients.length;
  const toggle = (d: string) => setOnly((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]));
  const shownNames = recipients.slice(0, 8).map((u) => u.username);

  async function send() {
    setBusy(true);
    try {
      const r = await client.broadcast(text, file ?? undefined, { departments: only });
      onDone(
        r.failed.length
          ? `Sent to ${r.sent}. Failed: ${r.failed.join(', ')}`
          : `Announcement sent to ${r.sent} employee${r.sent === 1 ? '' : 's'}${only.length ? ` in ${only.join(', ')}` : ''}`,
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
              <Megaphone size={18} />
            </span>
            New announcement
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="section-title" style={{ marginTop: 0 }}>
          Send to
        </div>
        <div className="chips" style={{ marginTop: 6 }}>
          <button className={only.length ? '' : 'active'} onClick={() => setOnly([])}>
            {!only.length && <Check size={13} />} Everyone ({reachable.length})
          </button>
          {departments.map((d) => (
            <button
              key={d}
              className={only.includes(d) ? 'active' : ''}
              disabled={!inDept(d) && !only.includes(d)}
              title={inDept(d) ? `Only people in ${d}` : `Nobody in ${d} has logged in yet`}
              onClick={() => toggle(d)}
            >
              {only.includes(d) && <Check size={13} />} {d} ({inDept(d)})
            </button>
          ))}
        </div>
        {!departments.length && (
          <p className="muted small" style={{ margin: '0 0 8px' }}>
            To send to one department only, add departments in 🛡 Admin → Departments and put people in them.
          </p>
        )}
        <p className="intro">
          {users === null ? (
            'Loading employees…'
          ) : (
            <>
              Goes to <strong>{count}</strong> employee{count === 1 ? '' : 's'}
              {only.length ? ` in ${only.join(' + ')}` : ''}
              {count > 0 && (
                <span className="muted">
                  {': '}
                  {shownNames.join(', ')}
                  {count > shownNames.length ? ` and ${count - shownNames.length} more` : ''}
                </span>
              )}
              .
            </>
          )}{' '}
          Each copy is end-to-end encrypted separately. Replies come back to you as private chats.
        </p>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write your announcement…"
          autoFocus
        />
        <div className="row" style={{ marginTop: 12 }}>
          <label className="file-btn">
            <Paperclip size={16} />
            <span>{file ? `${file.name} (${formatBytes(file.data.length)})` : 'Attach photo, PDF or file'}</span>
            <input type="file" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {file && (
            <button className="icon" title="Remove file" onClick={() => setFile(null)}>
              <X size={16} />
            </button>
          )}
          <div className="grow" />
          <button className="primary" disabled={busy || (!text.trim() && !file) || !count} onClick={send}>
            <Send size={16} />
            {busy ? 'Sending…' : only.length ? `Send to ${only.length === 1 ? only[0] : `${only.length} departments`}` : 'Send to everyone'}
          </button>
        </div>
      </div>
    </div>
  );
}
