import { useState, type FormEvent } from 'react';
import { client, useClient } from '../messenger';
import { Broadcast } from './Broadcast';
import { Employees } from './Employees';
import { MessengerClient } from '@meetme/core';

export function Sidebar({ onSettings, onError }: { onSettings: () => void; onError: (m: string) => void }) {
  const c = useClient();
  const [adding, setAdding] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [managing, setManaging] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    const name = adding.trim().toLowerCase();
    if (!name) return;
    try {
      await client.addContact(name);
      setAdding('');
      client.setActiveChat(name);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  const sorted = [...c.contacts].sort((a, b) => (c.lastMessage(b)?.ts ?? 0) - (c.lastMessage(a)?.ts ?? 0));

  return (
    <aside className="sidebar">
      <header>
        <div className="me">
          <div className="avatar">{c.account!.username[0]!.toUpperCase()}</div>
          <div>
            <div className="name">
              {c.account!.username} {c.isAdmin && <span className="admin-tag">ADMIN</span>}
            </div>
            <div className={`status ${c.status}`}>{c.status}</div>
          </div>
        </div>
        <div>
          {c.isAdmin && (
            <button
              className="icon"
              title="Employees: add, reset password, remove"
              disabled={c.status !== 'online'}
              onClick={() => setManaging(true)}
            >
              👥
            </button>
          )}
          {c.isAdmin && (
            <button
              className="icon"
              title="Announcement to all employees"
              disabled={c.status !== 'online'}
              onClick={() => setBroadcasting(true)}
            >
              📢
            </button>
          )}
          <button className="icon" title="Settings" onClick={onSettings}>
            ⚙
          </button>
        </div>
      </header>
      {broadcasting && <Broadcast onClose={() => setBroadcasting(false)} onDone={onError} />}
      {managing && <Employees onClose={() => setManaging(false)} onToast={onError} />}
      <form onSubmit={add} className="add">
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add contact by username" />
        <button className="icon" title="Add">
          ＋
        </button>
      </form>
      <ul className="contacts">
        {sorted.length === 0 && <li className="muted pad">No contacts yet</li>}
        {sorted.map((name) => {
          const last = c.lastMessage(name);
          const unread = c.getUnread(name);
          return (
            <li
              key={name}
              className={c.activeChat === name ? 'active' : ''}
              onClick={() => client.setActiveChat(name)}
            >
              <div className="avatar">{name[0]!.toUpperCase()}</div>
              <div className="grow">
                <div className="name">{name}</div>
                <div className="preview">{last ? (last.outgoing ? 'You: ' : '') + MessengerClient.preview(last) : ' '}</div>
              </div>
              {unread > 0 && <span className="badge">{unread}</span>}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
