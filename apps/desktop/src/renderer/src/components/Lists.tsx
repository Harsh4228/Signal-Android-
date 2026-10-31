import { useEffect, useState } from 'react';
import { Building2, Check, Search, Trash2, X } from 'lucide-react';
import { isGroupKey, type ChatList, type UserProfile } from '@meetme/core';
import { client, useClient } from '../messenger';
import { ChatAvatar, errorText } from './ui';

/**
 * Make or change one of my lists, like WhatsApp's lists: a name, and any people, groups, channels and whole
 * departments (everyone in them, also people who join later). It becomes a chip above the chat list.
 */
export function ChatListEditor({ list, onClose, onToast }: { list?: ChatList; onClose: (saved?: ChatList) => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [name, setName] = useState(list?.name ?? '');
  const [chats, setChats] = useState<string[]>(list?.chats ?? []);
  const [departments, setDepartments] = useState<string[]>(list?.departments ?? []);
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [tab, setTab] = useState<'people' | 'groups' | 'departments'>('people');
  const [query, setQuery] = useState('');
  useEffect(() => {
    client.listDirectory().then(setPeople, () => setPeople([]));
  }, []);
  const q = query.trim().toLowerCase();
  const match = (t: string) => !q || t.toLowerCase().includes(q);
  const groups = c.chatKeys().filter((k) => isGroupKey(k) && match(c.chatTitle(k)));
  const persons = people.filter((p) => match(`${p.name} ${p.username} ${p.departments.join(' ')}`));
  const allDepartments = [...new Set(people.flatMap((p) => p.departments))].sort().filter(match);
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const count = chats.length + departments.length;

  async function save() {
    try {
      const saved = await client.saveChatList({ id: list?.id, name, chats, departments });
      onToast(`List "${saved.name}" saved`);
      onClose(saved);
    } catch (e) {
      onToast(errorText(e));
    }
  }

  const row = (key: string, title: string, sub: string, on: boolean, flip: () => void, icon?: 'dept') => (
    <li key={key} className="clickable" onClick={flip}>
      {icon === 'dept' ? (
        <span className="avatar sm group-avatar">
          <Building2 size={16} />
        </span>
      ) : (
        <ChatAvatar chatKey={key} size="sm" />
      )}
      <div className="grow">
        <div className="name">{title}</div>
        {sub && <div className="muted small">{sub}</div>}
      </div>
      <span className={`tick ${on ? 'on' : ''}`}>{on && <Check size={14} />}</span>
    </li>
  );

  return (
    <div className="modal-bg" onClick={() => onClose()}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">{list ? 'Edit list' : 'New list'}</div>
          <button className="icon" onClick={() => onClose()} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body stack">
          <label className="field-label">
            List name
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales, Project Alpha, Managers" autoFocus />
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            Pick people, groups or whole departments. A department brings everyone in it, also people who join it later.
          </p>
          <nav className="tabs">
            {(
              [
                ['people', 'People'],
                ['groups', 'Groups & channels'],
                ['departments', 'Departments'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
          </div>
          <ul className="member-list pick-scroll">
            {tab === 'people' &&
              persons.map((p) =>
                row(p.username, p.name || client.displayName(p.username), p.departments.join(', '), chats.includes(p.username), () =>
                  toggle(chats, setChats, p.username),
                ),
              )}
            {tab === 'groups' &&
              groups.map((k) => row(k, c.chatTitle(k), c.isChannel(k) ? 'Channel' : 'Group', chats.includes(k), () => toggle(chats, setChats, k)))}
            {tab === 'departments' &&
              allDepartments.map((d) =>
                row(`d:${d}`, d, `${people.filter((p) => p.departments.includes(d)).length} people`, departments.includes(d), () => toggle(departments, setDepartments, d), 'dept'),
              )}
          </ul>
          <div className="row">
            {list && (
              <button
                className="danger-text"
                onClick={() => confirm(`Delete the list "${list.name}"? The chats stay.`) && void client.deleteChatList(list.id).then(() => onClose())}
              >
                <Trash2 size={15} /> Delete list
              </button>
            )}
            <div className="grow" />
            <span className="muted small">{count} chosen</span>
            <button className="primary" disabled={!name.trim() || !count} onClick={() => void save()}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
