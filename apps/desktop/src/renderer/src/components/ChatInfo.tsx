import { useEffect, useState } from 'react';
import { BadgeCheck, ChevronRight, Eraser, Mail, Phone, RotateCcw, Search, ShieldX, UserMinus, X } from 'lucide-react';
import { CatalogPanel } from './Catalog';
import { formatLastSeen, isGroupKey } from '@meetme/core';
import { client, useClient } from '../messenger';
import { Avatar, ChatAvatar, errorText } from './ui';
import { MediaSection } from './MediaGallery';

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
  const members = c.groupMembers(chatKey).filter((u) => u.includes(query.trim().toLowerCase()));
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
        Only admins can change the name or members. Every member gets their own end-to-end encrypted copy of each message.
      </p>
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
            title={u === me ? undefined : `Message ${u}`}
          >
            <ChatAvatar chatKey={u} size="sm" />
            <div className="grow">
              <div className="name">
                {u === me ? 'You' : u} {c.admins.includes(u) && <span className="tag admin">Admin</span>}{' '}
                {g?.senders && !c.admins.includes(u) && g.senders.includes(u) && <span className="tag share">Can send</span>}
              </div>
              {u !== me && (
                <div className={`small ${c.getPresence(u)?.online ? 'online-text' : 'muted'}`}>
                  {formatLastSeen(c.getPresence(u)) || 'Click to message'}
                </div>
              )}
              {c.profileOf(u)?.departments.length ? <div className="profile-line">{c.profileOf(u)!.departments.join(', ')}</div> : null}
            </div>
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
    </aside>
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
        <Avatar name={peer} />
        <div className="name">{peer}</div>
        <div className="muted small">{formatLastSeen(c.getPresence(peer))}</div>
        {profile && profile.departments.length > 0 && (
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
            {profile.departments.map((d) => (
              <span key={d} className="tag dept">
                {d}
              </span>
            ))}
          </div>
        )}
        {profile?.phone && (
          <div className="contact-line">
            <span>
              <Phone size={12} /> {profile.phone}
            </span>
          </div>
        )}
        {profile?.email && (
          <div className="contact-line">
            <span>
              <Mail size={12} /> {profile.email}
            </span>
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
            Compare these numbers with {peer} in person or on a call. If they match, nobody can be listening in.
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
        <button
          className="danger"
          onClick={() => {
            if (confirm(c.canClearHistory ? `Remove ${peer} and delete the chat?` : `Remove ${peer} from your chat list? The messages are kept.`)) {
              client.setActiveChat(null);
              void client.removeContact(peer);
            }
          }}
        >
          <UserMinus size={16} /> Remove contact
        </button>
      </div>
    </aside>
  );
}
