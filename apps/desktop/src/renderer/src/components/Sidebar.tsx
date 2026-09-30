import { useState, type FormEvent } from 'react';
import { Megaphone, MessageSquarePlus, Settings as SettingsIcon, UserPlus, Users } from 'lucide-react';
import { MessengerClient } from '@meetme/core';
import { client, useClient } from '../messenger';
import { Broadcast } from './Broadcast';
import { Employees } from './Employees';
import { Avatar, Logo, errorText, shortTime } from './ui';

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
      onError(errorText(err));
    }
  }

  const sorted = [...c.contacts].sort((a, b) => (c.lastMessage(b)?.ts ?? 0) - (c.lastMessage(a)?.ts ?? 0));
  const offline = c.status !== 'online';

  return (
    <aside className="sidebar">
      <header>
        <div className="brand">
          <Logo />
          MeetMe
        </div>
        <div className="actions">
          {c.isAdmin && (
            <button className="icon" title="Employees" disabled={offline} onClick={() => setManaging(true)}>
              <Users size={19} />
            </button>
          )}
          {c.isAdmin && (
            <button className="icon" title="Announcement to all employees" disabled={offline} onClick={() => setBroadcasting(true)}>
              <Megaphone size={19} />
            </button>
          )}
          <button className="icon" title="Settings" onClick={onSettings}>
            <SettingsIcon size={19} />
          </button>
        </div>
      </header>
      {broadcasting && <Broadcast onClose={() => setBroadcasting(false)} onDone={onError} />}
      {managing && <Employees onClose={() => setManaging(false)} onToast={onError} />}

      <form onSubmit={add} className="add">
        <UserPlus size={16} className="add-icon" />
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Start a chat by username" />
      </form>

      <ul className="contacts">
        {sorted.length === 0 && (
          <li className="none">
            <MessageSquarePlus size={28} color="var(--faint)" />
            <div>No conversations yet</div>
            <div className="small">Type a username above to start a secure chat.</div>
          </li>
        )}
        {sorted.map((name) => {
          const last = c.lastMessage(name);
          const unread = c.getUnread(name);
          return (
            <li
              key={name}
              className={`${c.activeChat === name ? 'active' : ''} ${unread ? 'unread' : ''}`}
              onClick={() => client.setActiveChat(name)}
            >
              <Avatar name={name} />
              <div className="grow">
                <div className="top">
                  <div className="name grow">{name}</div>
                  {last && <span className="when">{shortTime(last.ts)}</span>}
                </div>
                <div className="top">
                  <div className="preview grow">
                    {last ? (last.outgoing ? 'You: ' : '') + MessengerClient.preview(last) : 'No messages yet'}
                  </div>
                  {unread > 0 && <span className="badge">{unread}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="me">
        <Avatar name={c.account!.username} size="sm" />
        <div className="grow">
          <div className="name">
            {c.account!.username} {c.isAdmin && <span className="tag admin">Admin</span>}
          </div>
          <div className={`status ${c.status}`}>{c.status}</div>
        </div>
      </div>
    </aside>
  );
}
