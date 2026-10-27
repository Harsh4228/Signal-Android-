import { useEffect, useRef, useState } from 'react';
import { Ban, Bell, CircleDashed, EllipsisVertical, Lock, Megaphone, ShoppingBag, Star, MessageSquarePlus, Search, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { MessengerClient, isGroupKey } from '@meetme/core';
import { appLock, client, useClient, useLock } from '../messenger';
import { Broadcast } from './Broadcast';
import { AdminPanel } from './AdminPanel';
import { NoticesPanel } from './Notices';
import { StatusPanel } from './Status';
import { StarredPanel } from './ChatExtras';
import { CatalogPanel } from './Catalog';
import { Avatar, ChatAvatar, Logo, errorText, shortTime, typingText } from './ui';
import { Directory } from './Directory';

export function Sidebar({ onSettings, onError }: { onSettings: () => void; onError: (m: string) => void }) {
  const c = useClient();
  const lock = useLock();
  const [newChat, setNewChat] = useState(false);
  const [filter, setFilter] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [managing, setManaging] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [more, setMore] = useState(false);
  const [panel, setPanel] = useState<'starred' | 'catalog' | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const pick = (fn: () => void) => {
    setMore(false);
    fn();
  };

  // The ⋮ menu closes on a click anywhere else, or Esc.
  useEffect(() => {
    if (!more) return;
    const onDown = (e: MouseEvent) => !moreRef.current?.contains(e.target as Node) && setMore(false);
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), setMore(false));
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [more]);

  async function open(name: string) {
    try {
      await client.addContact(name);
      setNewChat(false);
      client.setActiveChat(name);
    } catch (err) {
      onError(errorText(err));
    }
  }

  const q = filter.trim().toLowerCase();
  const sorted = c
    .chatKeys()
    .filter((k) => !q || c.chatTitle(k).toLowerCase().includes(q))
    .sort((a, b) => (c.lastMessage(b)?.ts ?? 0) - (c.lastMessage(a)?.ts ?? 0));
  const offline = c.status !== 'online';

  return (
    <aside className="sidebar">
      <header>
        <div className="brand">
          <Logo />
          CellMate
        </div>
        <div className="actions">
          <button className={`icon ${newChat ? 'active' : ''}`} title="New chat" onClick={() => setNewChat((v) => !v)}>
            <MessageSquarePlus size={19} />
          </button>
          <button className="icon dot-host" title="Status" onClick={() => setShowStatus(true)}>
            <CircleDashed size={19} />
            {c.unseenStatusCount > 0 && <span className="dot" />}
          </button>
          <button className="icon" title={c.isAdmin ? 'Notices: send and see who read them' : 'Notices'} onClick={() => setShowNotices(true)}>
            <Bell size={19} />
          </button>
          {/* Everything else lives in the ⋮ menu, like WhatsApp. */}
          <div className="menu-host" ref={moreRef}>
            <button
              className={`icon ${more ? 'active' : ''}`}
              title="Menu"
              aria-haspopup="menu"
              aria-expanded={more}
              onClick={() => setMore((m) => !m)}
            >
              <EllipsisVertical size={19} />
            </button>
            {more && (
              <div className="dropdown" role="menu">
                {c.isAdmin && (
                  <button role="menuitem" disabled={offline} onClick={() => pick(() => setManaging(true))}>
                    <ShieldCheck size={17} /> Admin panel
                  </button>
                )}
                {c.isAdmin && (
                  <button role="menuitem" disabled={offline} onClick={() => pick(() => setBroadcasting(true))}>
                    <Megaphone size={17} /> New announcement
                  </button>
                )}
                {c.isAdmin && <hr />}
                <button role="menuitem" onClick={() => pick(() => setPanel('starred'))}>
                  <Star size={17} /> Starred messages
                </button>
                <button role="menuitem" onClick={() => pick(() => setPanel('catalog'))}>
                  <ShoppingBag size={17} /> My catalog
                </button>
                <hr />
                {lock.enabled && (
                  <button role="menuitem" onClick={() => pick(() => appLock.lock())}>
                    <Lock size={17} /> Lock now
                  </button>
                )}
                <button role="menuitem" onClick={() => pick(onSettings)}>
                  <SettingsIcon size={17} /> Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {broadcasting && <Broadcast onClose={() => setBroadcasting(false)} onDone={onError} />}
      {managing && <AdminPanel onClose={() => setManaging(false)} onToast={onError} />}
      {showNotices && <NoticesPanel onClose={() => setShowNotices(false)} onToast={onError} />}
      {showStatus && <StatusPanel onClose={() => setShowStatus(false)} onToast={onError} />}
      {panel === 'starred' && <StarredPanel onClose={() => setPanel(null)} />}
      {panel === 'catalog' && <CatalogPanel onClose={() => setPanel(null)} onToast={onError} />}

      {c.banned && (
        <div className="error" style={{ margin: '0 12px 8px' }}>
          <Ban size={16} />
          Your account is suspended by the admin. You can't send or receive messages.
        </div>
      )}

      {newChat ? (
        <Directory onOpen={(u) => void open(u)} onBack={() => setNewChat(false)} />
      ) : c.chatKeys().length === 0 ? (
        // First login: everyone is listed at once, no need to search for names.
        <Directory onOpen={(u) => void open(u)} />
      ) : (
        <>
      {c.chatKeys().length > 6 && (
        <div className="add">
          <Search size={16} className="add-icon" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search chats" />
        </div>
      )}

      <ul className="contacts">
        {sorted.length === 0 && (
          <li className="none">
            <MessageSquarePlus size={28} color="var(--faint)" />
            <div>{q ? 'No chats match' : 'No conversations yet'}</div>
          </li>
        )}
        {sorted.map((key) => {
          const last = c.lastMessage(key);
          const unread = c.getUnread(key);
          const group = isGroupKey(key);
          const typing = typingText(c.getTyping(key), group);
          const who = last && (last.outgoing ? 'You: ' : group && last.from ? `${client.displayName(last.from)}: ` : '');
          return (
            <li
              key={key}
              className={`${c.activeChat === key ? 'active' : ''} ${unread ? 'unread' : ''}`}
              onClick={() => client.setActiveChat(key)}
            >
              <ChatAvatar chatKey={key} />
              <div className="grow">
                <div className="top">
                  <div className="name grow">{c.chatTitle(key)}</div>
                  {last && <span className="when">{shortTime(last.ts)}</span>}
                </div>
                <div className="top">
                  <div className={`preview grow ${typing ? 'typing' : ''}`}>
                    {typing ||
                      (last
                        ? who + (last.deleted ? 'Message deleted' : MessengerClient.preview(last))
                        : group
                          ? `${c.groupOf(key)?.members.length ?? 0} members`
                          : 'No messages yet')}
                  </div>
                  {unread > 0 && <span className="badge">{unread}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
        </>
      )}

      <div className="me">
        <Avatar name={c.account!.username} size="sm" />
        <div className="grow">
          <div className="name">
            {c.displayName(c.account!.username)} {c.isAdmin && <span className="tag admin">Admin</span>}
          </div>
          <div className={`status ${c.banned ? 'offline' : c.status}`}>{c.banned ? 'suspended' : c.status}</div>
        </div>
      </div>
    </aside>
  );
}
