import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, BellOff, ChevronLeft, Phone, Pin, PinOff, Ban, Bell, CircleDashed, EllipsisVertical, LifeBuoy, Lock, Megaphone, MessageSquareText, ArrowUpDown, Check, ShoppingBag, Star, StarOff, Eraser, Trash2, UsersRound, X, MessageSquarePlus, Search, Settings as SettingsIcon, ShieldCheck, type LucideIcon } from 'lucide-react';
import { CHAT_SORTS, MessengerClient, isGroupKey, type ChatSort } from '@meetme/core';
import { appLock, client, useClient, useLock } from '../messenger';
import { Broadcast } from './Broadcast';
import { AdminPanel } from './AdminPanel';
import { NoticesPanel } from './Notices';
import { StatusPanel } from './Status';
import { StarredPanel } from './ChatExtras';
import { CatalogPanel } from './Catalog';
import { Avatar, ChatAvatar, PasswordInput, errorText, shortTime, typingText } from './ui';
import { AvatarTap } from './Profile';
import { CompanyBadge } from './Company';
import type { Tab as AdminTab } from './AdminPanel';
import { Directory } from './Directory';
import { HelpDeskModal } from './AdminRights';
import { CallsPanel } from './CallsPanel';
import { ChannelsPanel } from './Channels';

type Page = 'status' | 'calls' | 'channels' | 'notices' | 'help' | 'starred' | 'catalog' | 'admin';

export function Sidebar({ onSettings, onError }: { onSettings: () => void; onError: (m: string) => void }) {
  const c = useClient();
  const lock = useLock();
  const [newChat, setNewChat] = useState(false);
  const [filter, setFilter] = useState('');
  const [broadcasting, setBroadcasting] = useState(false);
  const [more, setMore] = useState(false);
  /** The page picked in the navigation (left rail, or the bottom bar on phones); null = the chat list. */
  const [panel, setPanel] = useState<Page | null>(null);
  const [archived, setArchived] = useState(false);
  const [view, setView] = useState<string>('all');
  const [chatSort, setChatSort] = useState<ChatSort>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const [adminStart, setAdminStart] = useState<{ tab?: AdminTab; newGroup?: boolean }>({});
  /** Right-click menu of a chat: pin, archive, mute. */
  const [chatMenu, setChatMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!chatMenu) return;
    const close = () => setChatMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [chatMenu]);
  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onError(errorText(e));
    }
  };
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
  const deptsOf = (k: string) => (isGroupKey(k) ? [] : (c.profileOf(k)?.departments ?? []));
  // The filter chips, like WhatsApp: All, Unread, Favourites, Groups, Channels, a department.
  const show = (k: string) =>
    view === 'all' ||
    (view === 'unread' && c.getUnread(k) > 0) ||
    (view === 'favourites' && c.isFavourite(k)) ||
    (view === 'groups' && isGroupKey(k) && !c.isChannel(k)) ||
    (view === 'channels' && c.isChannel(k)) ||
    (view.startsWith('dept:') && deptsOf(k).includes(view.slice(5)));
  // Pinned first, then the newest; archived chats have their own list (like WhatsApp).
  const sorted = c
    .orderedChats({ archived, sort: chatSort })
    .filter((k) => show(k) && (!q || c.chatTitle(k).toLowerCase().includes(q) || deptsOf(k).some((d) => d.toLowerCase().includes(q))));
  const allDepartments = [...new Set(c.chatKeys().flatMap(deptsOf))].sort();
  const offline = c.status !== 'online';

  const unreadChats = c.chatKeys().filter((k) => c.getUnread(k) > 0 && !c.isArchived(k)).length;
  const me = c.account!.username;
  /** Navigation like WhatsApp: a rail of icons on the left (computers), a bar at the bottom (phones). */
  const nav: { page: Page | null; icon: LucideIcon; label: string; badge?: number; dot?: boolean; phone?: boolean; off?: boolean }[] = [
    { page: null, icon: MessageSquareText, label: 'Chats', badge: unreadChats, phone: true },
    { page: 'status', icon: CircleDashed, label: 'Status', dot: c.unseenStatusCount > 0, phone: true },
    { page: 'channels', icon: Megaphone, label: 'Channels', phone: true, off: offline },
    { page: 'calls', icon: Phone, label: 'Calls', phone: true },
    { page: 'notices', icon: Bell, label: 'Notices', phone: true },
    { page: 'help', icon: LifeBuoy, label: 'Help desk', off: offline },
    { page: 'starred', icon: Star, label: 'Starred' },
    { page: 'catalog', icon: ShoppingBag, label: 'My catalog' },
  ];
  const go = (page: Page | null) => {
    setPanel(page);
    setMore(false);
  };

  return (
    <>
    <nav className="rail" aria-label="Navigation">
      {nav.map(({ page, icon: Icon, label, badge, dot, phone, off }) => (
        <button
          key={label}
          className={`rail-btn ${panel === page ? 'active' : ''} ${phone ? '' : 'desk-only'}`}
          title={label}
          disabled={off}
          onClick={() => go(page)}
        >
          <span className="rail-icon">
            <Icon size={22} />
            {!!badge && <span className="rail-badge">{badge > 99 ? '99+' : badge}</span>}
            {dot && <span className="rail-dot" />}
          </span>
          <span className="rail-label">{label}</span>
        </button>
      ))}
      <div className="rail-space" />
      {c.isAdmin && (
        <button className={`rail-btn desk-only ${panel === 'admin' ? 'active' : ''}`} title="Admin panel" disabled={offline} onClick={() => go('admin')}>
          <span className="rail-icon">
            <ShieldCheck size={22} />
          </span>
          <span className="rail-label">Admin</span>
        </button>
      )}
      <button className="rail-btn desk-only" title="Settings" onClick={onSettings}>
        <span className="rail-icon">
          <SettingsIcon size={22} />
        </span>
        <span className="rail-label">Settings</span>
      </button>
      <button className="rail-btn rail-me" title="Settings and my profile" onClick={onSettings}>
        <span className="rail-icon">
          <Avatar name={me} size="sm" />
        </span>
        <span className="rail-label">You</span>
      </button>
    </nav>
    <aside className="sidebar">
      <header>
        {archived ? <div className="sidebar-title">Archived</div> : <CompanyBadge onToast={onError} />}
        <div className="actions">
          <div className="menu-host">
            <button className={`icon ${sortOpen || chatSort !== 'recent' ? 'active' : ''}`} title="Sort chats" onClick={() => setSortOpen((v) => !v)}>
              <ArrowUpDown size={19} />
            </button>
            {sortOpen && (
              <div className="dropdown" role="menu" onMouseLeave={() => setSortOpen(false)}>
                {CHAT_SORTS.map(([v, label]) => (
                  <button key={v} role="menuitemradio" aria-checked={chatSort === v} onClick={() => (setChatSort(v), setSortOpen(false))}>
                    {chatSort === v ? <Check size={17} /> : <span style={{ width: 17 }} />} {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className={`icon ${newChat ? 'active' : ''}`} title="New chat" onClick={() => setNewChat((v) => !v)}>
            <MessageSquarePlus size={20} />
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
              <EllipsisVertical size={20} />
            </button>
            {more && (
              <div className="dropdown" role="menu">
                {c.isAdmin && (
                  <button role="menuitem" disabled={offline} onClick={() => go('admin')}>
                    <ShieldCheck size={17} /> Admin panel
                  </button>
                )}
                {c.isAdmin && (
                  <button role="menuitem" disabled={offline} onClick={() => pick(() => setBroadcasting(true))}>
                    <Megaphone size={17} /> New announcement
                  </button>
                )}
                {c.isAdmin && <hr />}
                {/* On phones these are not in the bottom bar. */}
                <button role="menuitem" className="phone-only" disabled={offline} onClick={() => go('help')}>
                  <LifeBuoy size={17} /> Help desk
                </button>
                <button role="menuitem" className="phone-only" onClick={() => go('starred')}>
                  <Star size={17} /> Starred messages
                </button>
                <button role="menuitem" className="phone-only" onClick={() => go('catalog')}>
                  <ShoppingBag size={17} /> My catalog
                </button>
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
      {/* Pages from the navigation sit beside the rail (above the bottom bar on phones), so it stays usable. */}
      <div className="nav-pages">
        {panel === 'admin' && (
          <AdminPanel
            onClose={() => (setPanel(null), setAdminStart({}))}
            onToast={onError}
            initialTab={adminStart.tab}
            newGroup={adminStart.newGroup}
          />
        )}
        {panel === 'notices' && <NoticesPanel onClose={() => setPanel(null)} onToast={onError} />}
        {panel === 'status' && <StatusPanel onClose={() => setPanel(null)} onToast={onError} />}
        {panel === 'starred' && <StarredPanel onClose={() => setPanel(null)} />}
        {panel === 'help' && <HelpDeskModal onClose={() => setPanel(null)} onToast={onError} />}
        {panel === 'calls' && <CallsPanel onClose={() => setPanel(null)} onError={onError} />}
        {panel === 'channels' && <ChannelsPanel onClose={() => setPanel(null)} onToast={onError} />}
        {panel === 'catalog' && <CatalogPanel onClose={() => setPanel(null)} onToast={onError} />}
      </div>

      {c.backupNeedsPassword && <BackupPrompt onError={onError} />}
      {c.banned && (
        <div className="error" style={{ margin: '0 12px 8px' }}>
          <Ban size={16} />
          Your account is suspended by the admin. You can't send or receive messages.
        </div>
      )}

      {newChat ? (
        <Directory onOpen={(u) => void open(u)} onBack={() => setNewChat(false)} onToast={onError} />
      ) : c.chatKeys().length === 0 ? (
        // First login: everyone is listed at once, no need to search for names.
        <Directory onOpen={(u) => void open(u)} onToast={onError} />
      ) : (
        <>
      <div className="add">
        <Search size={16} className="add-icon" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && filter && (e.preventDefault(), setFilter(''))}
          placeholder="Search name or department"
        />
        {filter && (
          <button className="icon add-clear" title="Clear search" onClick={() => setFilter('')}>
            <X size={16} />
          </button>
        )}
      </div>
      <div className="chips chat-chips">
        {(
          [
            ['all', 'All'],
            ['unread', `Unread${unreadChats ? ` ${unreadChats}` : ''}`],
            ['favourites', 'Favourites'],
            ['groups', 'Groups'],
            ['channels', 'Channels'],
            ...c.favouriteDepartments.map((d) => [`dept:${d}`, d]),
          ] as [string, string][]
        ).map(([id, label]) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(view === id && id !== 'all' ? 'all' : id)}>
            {label}
          </button>
        ))}
        {allDepartments.length > 0 && (
          <select
            className={`chip-select ${view.startsWith('dept:') && !c.favouriteDepartments.includes(view.slice(5)) ? 'active' : ''}`}
            value={view.startsWith('dept:') ? view.slice(5) : ''}
            onChange={(e) => setView(e.target.value ? `dept:${e.target.value}` : 'all')}
            title="Chats with people of a department"
          >
            <option value="">Department</option>
            {allDepartments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        {view.startsWith('dept:') && (
          <button
            className="icon"
            title={c.favouriteDepartments.includes(view.slice(5)) ? 'Remove this department from Favourites' : 'Keep this department as a filter'}
            onClick={() => void client.favouriteDepartment(view.slice(5), !c.favouriteDepartments.includes(view.slice(5)))}
          >
            <Star size={15} fill={c.favouriteDepartments.includes(view.slice(5)) ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      {view === 'groups' && c.isAdmin && (
        <button className="archived-row" disabled={offline} onClick={() => (setAdminStart({ tab: 'groups', newGroup: true }), go('admin'))}>
          <UsersRound size={17} /> <span className="grow">New group</span>
        </button>
      )}

      {archived ? (
        <button className="archived-row" onClick={() => setArchived(false)}>
          <ChevronLeft size={17} /> Archived chats
        </button>
      ) : (
        c.archivedCount > 0 && (
          <button className="archived-row" onClick={() => setArchived(true)}>
            <Archive size={17} /> <span className="grow">Archived</span> <span className="muted small">{c.archivedCount}</span>
          </button>
        )
      )}
      <ul className="contacts">
        {sorted.length === 0 && (
          <li className="none">
            <MessageSquarePlus size={28} color="var(--faint)" />
            <div>
              {q
                ? 'No chats match'
                : archived
                  ? 'No archived chats'
                  : view === 'favourites'
                    ? 'No favourites yet: right-click a chat > Add to favourites'
                    : view === 'all'
                      ? 'No conversations yet'
                      : 'No chats here'}
            </div>
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
              onContextMenu={(e) => {
                e.preventDefault();
                setChatMenu({ key, x: e.clientX, y: e.clientY });
              }}
              title="Right-click: favourite, pin, archive, mute, clear"
            >
              {group ? <ChatAvatar chatKey={key} /> : <AvatarTap user={key} onToast={onError} />}
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
                  {c.isMuted(key) && <BellOff size={14} className="muted" />}
                  {c.isPinned(key) && <Pin size={14} className="muted" />}
                  {c.mentionsMe(key) && <span className="badge">@</span>}
                  {unread > 0 && <span className={`badge ${c.isMuted(key) ? 'quiet' : ''}`}>{unread}</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
        </>
      )}

      {chatMenu && (
        <div className="dropdown context" role="menu" style={{ left: chatMenu.x, top: chatMenu.y }} onClick={(e) => e.stopPropagation()}>
          {[
            c.isPinned(chatMenu.key)
              ? { icon: PinOff, label: 'Unpin', go: () => client.pinChat(chatMenu.key, false) }
              : { icon: Pin, label: 'Pin to top', go: () => client.pinChat(chatMenu.key, true) },
            c.isFavourite(chatMenu.key)
              ? { icon: StarOff, label: 'Remove from favourites', go: () => client.favouriteChat(chatMenu.key, false) }
              : { icon: Star, label: 'Add to favourites', go: () => client.favouriteChat(chatMenu.key, true) },
            c.isArchived(chatMenu.key)
              ? { icon: ArchiveRestore, label: 'Unarchive', go: () => client.archiveChat(chatMenu.key, false) }
              : { icon: Archive, label: 'Archive', go: () => client.archiveChat(chatMenu.key, true) },
            ...(c.isMuted(chatMenu.key)
              ? [{ icon: Bell, label: 'Unmute', go: () => client.muteChat(chatMenu.key, 0) }]
              : [
                  { icon: BellOff, label: 'Mute for 8 hours', go: () => client.muteChat(chatMenu.key, 8 * 3600_000) },
                  { icon: BellOff, label: 'Mute for 1 week', go: () => client.muteChat(chatMenu.key, 7 * 86400_000) },
                  { icon: BellOff, label: 'Mute always', go: () => client.muteChat(chatMenu.key, Infinity) },
                ]),
            ...(c.canClearHistory
              ? [
                  {
                    icon: Eraser,
                    label: 'Clear chat',
                    go: () => confirm(`Clear all messages in ${c.chatTitle(chatMenu.key)}? The chat stays in your list.`) && void client.clearChat(chatMenu.key),
                  },
                ]
              : []),
            ...(isGroupKey(chatMenu.key)
              ? []
              : [
                  {
                    icon: Trash2,
                    label: 'Delete chat',
                    go: () => {
                      const name = c.chatTitle(chatMenu.key);
                      if (!confirm(c.canClearHistory ? `Delete the chat with ${name}? Its messages are removed from this device.` : `Remove ${name} from your chat list? The messages are kept.`)) return;
                      if (c.activeChat === chatMenu.key) client.setActiveChat(null);
                      void client.removeContact(chatMenu.key);
                    },
                  },
                ]),
          ].map(({ icon: Icon, label, go }) => (
            <button key={label} role="menuitem" onClick={() => (setChatMenu(null), run(go))}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>
      )}

    </aside>
    </>
  );
}

/** Signed in from before chat backups existed: one password entry turns the backup on (chats then follow to any device). */
function BackupPrompt({ onError }: { onError: (m: string) => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await client.enableBackup(pw);
      onError('Chat backup is on: your chats now follow you to every device');
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="notice stack" style={{ margin: '0 12px 8px' }} onSubmit={(e) => (e.preventDefault(), void save())}>
      <span>Turn on chat backup so your chats come back on any device you sign in to. Enter your login password once.</span>
      <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your login password" autoComplete="current-password" />
      <button className="primary" disabled={busy || !pw}>
        Turn on chat backup
      </button>
    </form>
  );
}