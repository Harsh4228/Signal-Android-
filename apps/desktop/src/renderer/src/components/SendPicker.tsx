import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { isGroupKey, type UserProfile } from '@meetme/core';
import { client, useClient } from '../messenger';
import { ChatAvatar } from './ui';

/**
 * "Send to…" / "Forward to…": pick one or more chats. My chats come first, then everyone else in the company
 * (search finds any colleague by name, ID, department or employee ID, also people I never chatted with).
 */
export function SendPicker({
  title,
  icon,
  files,
  submit,
  top,
  disabled,
  onSend,
  onClose,
}: {
  title: string;
  icon: ReactNode;
  /** Sending files: only chats where the admin allows files. */
  files: boolean;
  /** The button text for n chosen chats. */
  submit: (n: number) => string;
  /** Shown above the search (what is being sent, a message box…). */
  top?: ReactNode;
  disabled?: boolean;
  /** Chats I never had are started first (ensureChat); report the result yourself. */
  onSend: (keys: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const c = useClient();
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    client.listDirectory().then(setPeople, () => setPeople([]));
  }, []);
  const keys = c.sendTargets(people, query, files);
  const chats = new Set(c.chatKeys());

  async function send() {
    setBusy(true);
    try {
      for (const k of picked) await client.ensureChat(k).catch(() => {});
      await onSend(picked);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={(e) => (e.stopPropagation(), onClose())}>
      <div className="modal send-picker" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">{icon}</span>
            <span className="ellipsis">{title}</span>
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body stack" style={{ gap: 10 }}>
          {top}
          <div className="search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, ID or department" autoFocus />
          </div>
          <ul className="emp-list forward-list pick-list send-picker-list">
            {!keys.length && <li className="muted">{query ? 'Nobody matches.' : 'No chats yet.'}</li>}
            {keys.map((k, i) => {
              const fresh = !chats.has(k) && !isGroupKey(k);
              const firstFresh = fresh && (i === 0 || chats.has(keys[i - 1]!));
              const depts = fresh ? c.profileOf(k)?.departments.join(', ') : '';
              return (
                <Fragment key={k}>
                  {firstFresh && <li className="list-divider">Other people</li>}
                  <li onClick={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>
                    <input type="checkbox" checked={picked.includes(k)} readOnly />
                    <ChatAvatar chatKey={k} />
                    <div className="grow">
                      <div className="name">{c.chatTitle(k)}</div>
                      {depts && <div className="muted small">{depts}</div>}
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ul>
          <div className="row-end" style={{ marginTop: 0 }}>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!picked.length || busy || disabled} onClick={() => void send()}>
              {icon} {submit(picked.length)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
