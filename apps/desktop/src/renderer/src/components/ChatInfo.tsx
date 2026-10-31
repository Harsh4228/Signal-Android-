import { useEffect, useState } from 'react';
import { Ban, BadgeCheck, Building2, Cake, Check, Flag, ChevronRight, Eraser, KeyRound, Mail, Phone, RotateCcw, Search, ShieldPlus, ShieldX, UserMinus, UserPlus, Video, X } from 'lucide-react';
import { CatalogPanel } from './Catalog';
import { birthdayText, formatLastSeen, groupIdOf, isGroupKey, type UserProfile } from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { AvatarTap, ProfileHero, StatusOf, idLine, telLink } from './Profile';
import { Avatar, ChatAvatar, errorText } from './ui';
import { MediaSection } from './MediaGallery';
import { GroupRightsModal } from './AdminRights';
import { ReportDialog, toggleBlock } from './Safety';

const TIMERS: [number, string][] = [
  [0, 'Off'],
  [30, '30 seconds'],
  [300, '5 minutes'],
  [3600, '1 hour'],
  [86400, '1 day'],
  [604800, '1 week'],
];

function GroupDetails({ chatKey, onClose, onError }: { chatKey: string; onClose: () => void; onError: (m: string) => void }) {
  const c = useClient();
  const g = c.groupOf(chatKey);
  const me = c.account?.username;
  const [query, setQuery] = useState('');
  const [rights, setRights] = useState(false);
  const [adding, setAdding] = useState(false);
  const manage = c.isGroupAdmin(chatKey);
  const groupAdmins = g?.admins ?? [];
  const q = query.trim().toLowerCase();
  const members = c.groupMembers(chatKey).filter((u) => !q || ` ${client.displayName(u)}`.toLowerCase().includes(q));
  const change = (changes: { members?: string[]; admins?: string[] }, done: string) =>
    void client.updateMyGroup(groupIdOf(chatKey), changes).then(() => onError(done), (e) => onError(errorText(e)));
  const count = g?.members.length ?? 0;
  useEffect(() => {
    void client.refreshPresence(g?.members ?? []);
  }, [g?.members]);
  return (
    <aside className="info">
      <header>
        <span>Group details</span>
        <button className="icon" onClick={onClose} title="Close">
          <X size={18} />
        </button>
      </header>
      <div className="profile">
        <ChatAvatar chatKey={chatKey} size="xl" />
        <div className="name">{c.chatTitle(chatKey)}</div>
        <div className="muted small">
          Group · {count} member{count === 1 ? '' : 's'}
        </div>
        {g?.senders && (
          <div className="muted small">
            Only {g.senders.length ? g.senders.join(', ') + ' and admins' : 'admins'} can send messages
          </div>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        {manage ? 'You manage this group: add people, choose group admins and set what members may do here.' : 'Only admins can change the name or members.'}{' '}
        Every member gets their own end-to-end encrypted copy of each message.
      </p>
      {manage && g && (
        <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setAdding(true)}>
            <UserPlus size={15} /> Add members
          </button>
          <button onClick={() => setRights(true)}>
            <KeyRound size={15} /> Group permissions
          </button>
        </div>
      )}
      <MediaSection chatKey={chatKey} onToast={onError} />
      <div className="section-title">
        {count} member{count === 1 ? '' : 's'}
      </div>
      {count > 8 && (
        <div className="search" style={{ marginBottom: 6 }}>
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members" />
        </div>
      )}
      <ul className="member-list">
        {!members.length && <li className="muted small">No members match.</li>}
        {members.map((u) => (
          <li
            key={u}
            className={u === me ? '' : 'clickable'}
            onClick={() => u !== me && void client.addContact(u).then(() => client.setActiveChat(u))}
            title={u === me ? undefined : `Message ${client.displayName(u)}`}
          >
            {u === me ? <ChatAvatar chatKey={u} size="sm" /> : <AvatarTap user={u} size="sm" onToast={onError} />}
            <div className="grow">
              <div className="name">
                {u === me ? 'You' : client.displayName(u)} {c.admins.includes(u) && <span className="tag admin">Admin</span>}{' '}
                {groupAdmins.includes(u) && !c.admins.includes(u) && <span className="tag share">Group admin</span>}{' '}
                {g?.senders && !c.admins.includes(u) && g.senders.includes(u) && <span className="tag share">Can send</span>}
              </div>
              {u !== me && (
                <div className={`small ${c.getPresence(u)?.online ? 'online-text' : 'muted'}`}>
                  {formatLastSeen(c.getPresence(u)) || 'Click to message'}
                </div>
              )}
              {c.profileOf(u)?.departments.length ? <div className="profile-line">{c.profileOf(u)!.departments.join(', ')}</div> : null}
            </div>
            {manage && g && (
              <span className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                {groupAdmins.includes(u) ? (
                  <button className="icon" title="Dismiss as group admin" onClick={() => change({ admins: groupAdmins.filter((x) => x !== u) }, 'Group admins changed')}>
                    <ShieldX size={15} />
                  </button>
                ) : (
                  <button className="icon" title="Make group admin" onClick={() => change({ admins: [...groupAdmins, u] }, 'Group admins changed')}>
                    <ShieldPlus size={15} />
                  </button>
                )}
                {u !== me && (
                  <button className="icon danger-text" title="Remove from group" onClick={() => change({ members: g.members.filter((x) => x !== u) }, 'Removed from the group')}>
                    <UserMinus size={15} />
                  </button>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
      {c.canClearHistory && (
        <>
          <div className="section-title">Privacy</div>
          <button onClick={() => confirm('Clear this chat and delete its saved photos and documents?') && client.clearChat(chatKey)}>
            <Eraser size={16} /> Clear chat and its files
          </button>
        </>
      )}
      {rights && g && <GroupRightsModal group={g} onClose={() => setRights(false)} onToast={onError} />}
      {adding && g && (
        <AddMembers
          members={g.members}
          onClose={() => setAdding(false)}
          onAdd={(list) => {
            setAdding(false);
            change({ members: [...g.members, ...list] }, `Added ${list.length} to the group`);
          }}
        />
      )}
    </aside>
  );
}

/** Group admins: pick colleagues to add (from the company directory). */
function AddMembers({ members, onClose, onAdd }: { members: string[]; onClose: () => void; onAdd: (list: string[]) => void }) {
  const [people, setPeople] = useState<UserProfile[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    client.listDirectory().then(setPeople, () => setPeople([]));
  }, []);
  const q = query.trim().toLowerCase();
  const shown = (people ?? []).filter((p) => !members.includes(p.username) && ` ${p.username}`.toLowerCase().includes(q));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">Add members</div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body">
          <div className="search" style={{ marginBottom: 8 }}>
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search colleagues" autoFocus />
          </div>
          {people === null && <p className="muted">Loading…</p>}
          {people && !shown.length && <p className="muted small">Everyone is already in the group.</p>}
          <ul className="member-list">
            {shown.map((p) => {
              const on = picked.includes(p.username);
              return (
                <li key={p.username} className="clickable" onClick={() => setPicked(on ? picked.filter((u) => u !== p.username) : [...picked, p.username])}>
                  <Avatar name={p.username} size="sm" />
                  <div className="grow">
                    <div className="name">{p.name || p.username}</div>
                    {p.departments.length ? <div className="profile-line">{p.departments.join(', ')}</div> : null}
                  </div>
                  {on && <Check size={17} />}
                </li>
              );
            })}
          </ul>
          <button className="primary" disabled={!picked.length} onClick={() => onAdd(picked)} style={{ marginTop: 10 }}>
            Add {picked.length || ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatInfo({ peer, onClose, onError }: { peer: string; onClose: () => void; onError: (m: string) => void }) {
  if (isGroupKey(peer)) return <GroupDetails chatKey={peer} onClose={onClose} onError={onError} />;
  return <PersonInfo peer={peer} onClose={onClose} onError={onError} />;
}

function PersonInfo({ peer, onClose, onError }: { peer: string; onClose: () => void; onError: (m: string) => void }) {
  const c = useClient();
  const profile = c.profileOf(peer);
  const [safety, setSafety] = useState<{ number: string; verified: boolean } | null>(null);
  // Their catalog, like a WhatsApp Business profile (shown only if they have products).
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [status, setStatus] = useState(false);
  useEffect(() => {
    client
      .listProducts(peer)
      .then((p) => setCatalogCount(p.length))
      .catch(() => setCatalogCount(null));
  }, [peer]);

  const reload = () => void client.getSafetyNumber(peer).then(setSafety);
  useEffect(reload, [peer]);

  const run = (fn: () => Promise<unknown>) => () => fn().then(reload).catch((e) => onError(errorText(e)));

  return (
    <aside className="info">
      <header>
        <span>Conversation details</span>
        <button className="icon" onClick={onClose} title="Close">
          <X size={18} />
        </button>
      </header>

      <div className="profile">
        <ProfileHero user={peer} />
        <div className="name">{client.displayName(peer)}</div>
        <div className="muted small">{idLine(peer)}</div>
        <div className="muted small">{formatLastSeen(c.getPresence(peer))}</div>
        {profile?.about && <div className="about-line">{profile.about}</div>}
        <div className="profile-actions">
          <button onClick={() => void calls.startCall(peer, false).catch((e) => onError(errorText(e)))}>
            <Phone size={18} /> Voice
          </button>
          <button onClick={() => void calls.startCall(peer, true).catch((e) => onError(errorText(e)))}>
            <Video size={18} /> Video
          </button>
        </div>
      </div>

      {c.statusRingOf(peer) && (
        <button className="media-head" onClick={() => setStatus(true)}>
          <span className={`avatar-wrap ring ${c.statusRingOf(peer)}`}>
            <Avatar name={peer} size="sm" />
          </span>
          <span className="grow">Status</span>
          <span className="muted small">{c.statusRingOf(peer) === 'new' ? 'New update' : 'Viewed'}</span>
          <ChevronRight size={16} />
        </button>
      )}
      {status && <StatusOf user={peer} onClose={() => setStatus(false)} onToast={onError} />}

      <div className="detail-list">
        {profile && profile.departments.length > 0 && (
          <div className="detail-row">
            <Building2 size={17} />
            <div className="grow">
              <div>{profile.departments.join(', ')}</div>
              <div className="muted small">Department</div>
            </div>
          </div>
        )}
        {profile?.phone && (
          <a className="detail-row" href={telLink(profile.phone)} title="Call with your phone app">
            <Phone size={17} />
            <div className="grow">
              <div>{profile.phone}</div>
              <div className="muted small">Mobile</div>
            </div>
          </a>
        )}
        {profile?.email && (
          <a className="detail-row" href={`mailto:${profile.email}`} title="Write an email">
            <Mail size={17} />
            <div className="grow">
              <div>{profile.email}</div>
              <div className="muted small">Email</div>
            </div>
          </a>
        )}
        {birthdayText(profile?.birthday) && (
          <div className="detail-row">
            <Cake size={17} />
            <div className="grow">
              <div>{birthdayText(profile?.birthday)}</div>
              <div className="muted small">Birth date</div>
            </div>
          </div>
        )}
      </div>

      <MediaSection chatKey={peer} onToast={onError} />
      {catalogCount !== null && catalogCount > 0 && (
        <button className="media-head" onClick={() => setShowCatalog(true)}>
          <span className="grow">Catalog</span>
          <span className="muted">{catalogCount}</span>
          <ChevronRight size={16} />
        </button>
      )}
      {showCatalog && <CatalogPanel owner={peer} onClose={() => setShowCatalog(false)} onToast={onError} />}

      <div className="section-title">Safety number</div>
      {safety ? (
        <>
          <pre className="safety">{safety.number}</pre>
          <p className="muted small" style={{ margin: '0 0 4px' }}>
            Compare these numbers with {client.displayName(peer)} in person or on a call. If they match, nobody can be listening in.
          </p>
          <button
            className={safety.verified ? '' : 'primary'}
            onClick={run(() => client.setVerified(peer, !safety.verified))}
          >
            {safety.verified ? <ShieldX size={16} /> : <BadgeCheck size={16} />}
            {safety.verified ? 'Clear verification' : 'Mark as verified'}
          </button>
        </>
      ) : (
        <p className="muted small">Send or receive a message first to set up the secure session.</p>
      )}

      <div className="section-title">Disappearing messages</div>
      {c.canClearHistory ? (
        <select
          value={c.getDisappearingTimer(peer)}
          onChange={(e) => run(() => client.setDisappearingTimer(peer, Number(e.target.value)))()}
        >
          {TIMERS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          {c.getDisappearingTimer(peer)
            ? `On (${TIMERS.find(([v]) => v === c.getDisappearingTimer(peer))?.[1] ?? 'set by your admin'}), set by your admin.`
            : 'Off. Your admin keeps chat history, so messages don\'t disappear.'}
        </p>
      )}

      <div className="section-title">Privacy</div>
      <div className="stack">
        {c.canClearHistory && (
          <button onClick={() => confirm('Clear this chat and delete its saved photos and documents?') && client.clearChat(peer)}>
            <Eraser size={16} /> Clear chat and its files
          </button>
        )}
        <button onClick={run(() => client.resetSession(peer))}>
          <RotateCcw size={16} /> Reset secure session
        </button>
        <button className={c.isBlocked(peer) ? undefined : 'danger'} onClick={() => toggleBlock(peer, onError)}>
          <Ban size={16} /> {c.isBlocked(peer) ? 'Unblock' : 'Block'} {client.displayName(peer)}
        </button>
        <button className="danger" onClick={() => setReporting(true)}>
          <Flag size={16} /> Report {client.displayName(peer)}
        </button>
        <button
          className="danger"
          onClick={() => {
            if (confirm(c.canClearHistory ? `Remove ${client.displayName(peer)} and delete the chat?` : `Remove ${client.displayName(peer)} from your chat list? The messages are kept.`)) {
              client.setActiveChat(null);
              void client.removeContact(peer);
            }
          }}
        >
          <UserMinus size={16} /> Remove contact
        </button>
      </div>
      {reporting && <ReportDialog user={peer} onClose={() => setReporting(false)} onToast={onError} />}
    </aside>
  );
}
