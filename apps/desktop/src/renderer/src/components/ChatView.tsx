import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Ban,
  BadgeCheck,
  BarChart3,
  CalendarDays,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  File,
  FileText,
  Forward,
  Image,
  Info,
  Lock,
  MapPin,
  Megaphone,
  Mic,
  Paperclip,
  Pencil,
  Reply,
  Search,
  ShoppingBag,
  SmilePlus,
  Star,
  UserRound,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  SendHorizontal,
  ShieldAlert,
  Timer,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  MessengerClient,
  callDetail,
  callMissed,
  callTitle,
  formatLastSeen,
  isGroupKey,
  type CallLog,
  type ChatMessage,
} from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { ChatInfo } from './ChatInfo';
import { AttachmentView } from './AttachmentView';
import { EventView, NewEvent, NewPoll, PollView } from './PollEvent';
import {
  AudioView,
  ContactCardView,
  ContactPicker,
  ForwardPicker,
  LocationCardView,
  LocationPicker,
  ProductCardView,
  QuoteView,
  ReactionChips,
  ReactionPicker,
  VoiceRecorder,
} from './ChatExtras';
import { CatalogPanel } from './Catalog';
import { ChatAvatar, errorText, typingText } from './ui';

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Arrow-style phone icons like WhatsApp: out, in, missed; a camera for video calls. */
function CallIcon({ c }: { c: CallLog }) {
  if (c.video) return <Video size={18} />;
  if (c.outcome === 'missed') return <PhoneMissed size={18} />;
  return c.outgoing ? <PhoneOutgoing size={18} /> : <PhoneIncoming size={18} />;
}

function Tick({ status }: { status: NonNullable<ChatMessage['status']> }) {
  const Icon =
    status === 'sending' ? Clock3 : status === 'sent' ? Check : status === 'failed' ? CircleAlert : CheckCheck;
  return (
    <span className={`tick ${status}`} title={status}>
      <Icon size={14} />
    </span>
  );
}

export function ChatView({ peer, onError }: { peer: string; onError: (m: string) => void }) {
  const c = useClient();
  const group = isGroupKey(peer);
  const groupInfo = c.groupOf(peer);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [reactingTo, setReactingTo] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [viewingCatalog, setViewingCatalog] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [verified, setVerified] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messages = c.getMessages(peer);
  const timer = c.getDisappearingTimer(peer);
  const online = c.status === 'online';
  const gone = group && !groupInfo; // removed from the group, or the group was deleted
  const canWrite = online && !gone;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    if (!group) void client.getSafetyNumber(peer).then((s) => setVerified(!!s?.verified));
  }, [peer, group, showInfo, messages.length]);

  useEffect(() => {
    if (!group) void client.refreshPresence([peer]);
  }, [peer, group]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const t = text;
    if (!t.trim()) return;
    setText('');
    try {
      if (editing) {
        const m = editing;
        setEditing(null);
        await client.editMessage(peer, m.id, t);
      } else {
        const r = replyTo;
        setReplyTo(null);
        await client.sendText(peer, t, { replyTo: r ?? undefined });
      }
    } catch (err) {
      onError(errorText(err));
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    } else if (e.key === 'Escape' && editing) {
      e.preventDefault();
      setEditing(null);
      setText('');
    } else if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      setReplyTo(null);
    }
  }

  function startReply(m: ChatMessage) {
    setEditing(null);
    setReplyTo(m);
    inputRef.current?.focus();
  }

  /** Scroll to a message and flash it (reply quotes, search results). */
  function jumpTo(id: string) {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return onError('That message is no longer in this chat');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlash(id);
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
  }

  async function sendVoice(data: Uint8Array, mime: string) {
    setRecording(false);
    const r = replyTo;
    setReplyTo(null);
    try {
      await client.sendFile(peer, { name: `voice-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`, mime, data }, '', {
        replyTo: r ?? undefined,
      });
    } catch (err) {
      onError(errorText(err));
    }
  }

  function startEdit(m: ChatMessage) {
    setMenuFor(null);
    setEditing(m);
    setText(m.text);
    inputRef.current?.focus();
  }

  async function remove(m: ChatMessage, forEveryone: boolean) {
    setMenuFor(null);
    try {
      await client.deleteMessage(peer, m.id, forEveryone);
    } catch (err) {
      onError(errorText(err));
    }
  }

  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState<'poll' | 'event' | 'location' | 'contact' | 'catalog' | null>(null);

  function pick(accept: string) {
    setMenu(false);
    if (!fileInput.current) return;
    fileInput.current.accept = accept;
    fileInput.current.value = '';
    fileInput.current.click();
  }

  async function onFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    const caption = text;
    setText('');
    const r = replyTo;
    setReplyTo(null);
    try {
      // Read into memory only; the original file on disk is untouched and nothing new is written.
      const data = new Uint8Array(await f.arrayBuffer());
      await client.sendFile(peer, { name: f.name, mime: f.type || 'application/octet-stream', data }, caption, { replyTo: r ?? undefined });
    } catch (err) {
      onError(errorText(err));
    }
  }

  function call(video: boolean) {
    calls.startCall(peer, video).catch((err) => onError(errorText(err)));
  }

  const typing = typingText(c.getTyping(peer), group);
  const presence = group ? '' : formatLastSeen(c.getPresence(peer));
  const profile = group ? undefined : c.profileOf(peer);
  const contactLine = [profile?.phone, profile?.email].filter(Boolean).join(' · ');

  return (
    <section className="chat">
      <header>
        {/* Click the picture or name for the member list (groups) or contact info, like WhatsApp. */}
        <button
          className="chat-title"
          title={group ? 'Group info and members' : 'Contact info'}
          onClick={() => setShowInfo((s) => !s)}
        >
          <ChatAvatar chatKey={peer} />
          <div className="grow">
            {/* Name with the department next to it; mobile · email underneath. */}
            <div className="name">
              {c.chatTitle(peer)}{' '}
              {!group &&
                profile?.departments.map((d) => (
                  <span key={d} className="tag dept">
                    {d}
                  </span>
                ))}{' '}
              {verified && (
                <span className="tag verified" title="Safety number verified">
                  <BadgeCheck size={12} /> Verified
                </span>
              )}
            </div>
            <div className="sub">
              {typing ? (
                <span className="typing">{typing}</span>
              ) : group ? (
                <span className="member-line">{c.groupMemberLine(peer) || 'No members'}</span>
              ) : contactLine ? (
                <span className="member-line">{contactLine}</span>
              ) : presence ? (
                <span className={presence === 'online' ? 'online-text' : ''}>{presence}</span>
              ) : null}
              {timer ? (
                <>
                  {' · '}
                  <Timer size={12} /> Disappearing messages on
                </>
              ) : null}
            </div>
          </div>
        </button>
        <div className="actions">
          {!group && (
            <>
              <button className="icon" title="Voice call" disabled={!online} onClick={() => call(false)}>
                <Phone size={19} />
              </button>
              <button className="icon" title="Video call" disabled={!online} onClick={() => call(true)}>
                <Video size={20} />
              </button>
            </>
          )}
          <button
            className={`icon ${searching ? 'active' : ''}`}
            title="Search in this chat"
            onClick={() => {
              setSearching((s) => !s);
              setQuery('');
            }}
          >
            <Search size={19} />
          </button>
          <button className={`icon ${showInfo ? 'active' : ''}`} title="Chat info" onClick={() => setShowInfo((s) => !s)}>
            <Info size={19} />
          </button>
        </div>
      </header>
      {searching && (
        <div className="chat-search">
          <div className="search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search messages" autoFocus onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setSearching(false))} />
          </div>
          {query.trim() && (
            <ul className="search-results">
              {!c.searchMessages(peer, query).length && <li className="muted small">No messages found</li>}
              {c.searchMessages(peer, query).slice(0, 50).map((m) => (
                <li key={m.id} onClick={() => jumpTo(m.id)}>
                  <span className="muted small">
                    {m.outgoing ? 'You' : (m.from ?? peer)} · {time(m.ts)}
                  </span>
                  <span className="grow result-text">{MessengerClient.preview(m)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="body">
        <div
          className="messages"
          onClick={() => {
            setMenuFor(null);
            setReactingTo(null);
          }}
        >
          {messages.map((m) =>
            m.call ? (
              <div key={m.id} className={`bubble call-entry ${m.outgoing ? 'out' : 'in'}`}>
                <span className={`call-icon ${callMissed(m.call) ? 'missed' : ''}`}>
                  <CallIcon c={m.call} />
                </span>
                <div className="grow">
                  <div className="call-title">{callTitle(m.call)}</div>
                  <div className="call-sub">
                    {callDetail(m.call)}
                    {callDetail(m.call) ? ' · ' : ''}
                    {time(m.ts)}
                  </div>
                </div>
                <button className="call-back" title={`Call ${client.displayName(peer)} back`} onClick={() => call(m.call!.video)}>
                  {m.call.video ? <Video size={15} /> : <Phone size={15} />} Call back
                </button>
              </div>
            ) : m.system ? (
              <div key={m.id} className="system">
                <ShieldAlert size={13} />
                {m.text}
              </div>
            ) : (
              <div
                key={m.id}
                id={`msg-${m.id}`}
                className={`bubble ${m.outgoing ? 'out' : 'in'}${m.broadcast ? ' announce' : ''}${m.deleted ? ' deleted' : ''}${flash === m.id ? ' flash' : ''}${m.reactions && Object.keys(m.reactions).length ? ' has-reactions' : ''}`}
              >
                {!m.deleted && (
                  <MessageActions
                    m={m}
                    open={menuFor === m.id}
                    canEdit={m.outgoing && c.canEditDelete && !!m.text && !m.poll && !m.event}
                    canDeleteAll={c.canEditDelete && (m.outgoing || c.isAdmin)}
                    canDeleteMine={c.canClearHistory}
                    canReply={canWrite && c.canSendTo(peer)}
                    canForward={!m.poll && !m.event && (!m.attachment || !!m.attachment.data)}
                    onMenu={() => setMenuFor(menuFor === m.id ? null : m.id)}
                    onEdit={() => startEdit(m)}
                    onDelete={(all) => void remove(m, all)}
                    onReply={() => startReply(m)}
                    onReact={() => setReactingTo(reactingTo === m.id ? null : m.id)}
                    onForward={() => setForwarding(m)}
                    onStar={() => client.toggleStar(m)}
                  />
                )}
                {reactingTo === m.id && <ReactionPicker chat={peer} m={m} onDone={() => setReactingTo(null)} onError={onError} />}
                {group && !m.outgoing && m.from && <div className="sender">{client.displayName(m.from)}</div>}
                {m.forwarded && !m.deleted && (
                  <div className="forwarded">
                    <Forward size={12} /> Forwarded
                  </div>
                )}
                {m.replyTo && !m.deleted && <QuoteView q={m.replyTo} onJump={() => jumpTo(m.replyTo!.id)} />}
                {m.broadcast && !m.deleted && (
                  <div className="announce-label">
                    <Megaphone size={13} /> Announcement
                  </div>
                )}
                {m.deleted ? (
                  <div className="text deleted-text">
                    <Ban size={13} /> This message was deleted
                  </div>
                ) : (
                  <>
                    {m.attachment &&
                      (m.attachment.kind === 'audio' ? <AudioView a={m.attachment} /> : <AttachmentView a={m.attachment} onToast={onError} />)}
                    {m.poll && <PollView chat={peer} m={m} onError={onError} />}
                    {m.event && <EventView chat={peer} m={m} onError={onError} />}
                    {m.contact && <ContactCardView username={m.contact} />}
                    {m.location && <LocationCardView l={m.location} />}
                    {m.product && <ProductCardView p={m.product} onViewCatalog={setViewingCatalog} />}
                    {m.text && <div className="text">{m.text}</div>}
                  </>
                )}
                <div className="meta">
                  {m.starred && <Star size={11} className="star-mark" />}
                  {m.edited && <span className="edited">edited</span>}
                  {m.expiresAt && (
                    <span title="Disappearing message" className="tick">
                      <Timer size={12} />
                    </span>
                  )}
                  {time(m.ts)}
                  {m.outgoing && m.status && <Tick status={m.status} />}
                </div>
                {!m.deleted && <ReactionChips chat={peer} m={m} onError={onError} />}
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
        {showInfo && <ChatInfo peer={peer} onClose={() => setShowInfo(false)} onError={onError} />}
      </div>
      {creating === 'poll' && <NewPoll chat={peer} onClose={() => setCreating(null)} onError={onError} />}
      {creating === 'event' && <NewEvent chat={peer} onClose={() => setCreating(null)} onError={onError} />}
      {creating === 'location' && <LocationPicker chat={peer} onClose={() => setCreating(null)} onError={onError} />}
      {creating === 'contact' && <ContactPicker chat={peer} onClose={() => setCreating(null)} onError={onError} />}
      {creating === 'catalog' && <CatalogPanel chat={peer} onClose={() => setCreating(null)} onToast={onError} />}
      {viewingCatalog && <CatalogPanel owner={viewingCatalog} onClose={() => setViewingCatalog(null)} onToast={onError} />}
      {forwarding && <ForwardPicker m={forwarding} onClose={() => setForwarding(null)} onToast={onError} />}

      {gone ? (
        <div className="composer-note">You are no longer a member of this group.</div>
      ) : !c.canSendTo(peer) ? (
        <div className="composer-note">
          <Lock size={14} /> Only {groupInfo?.senders?.length ? groupInfo.senders.join(', ') + ' and admins' : 'admins'} can send
          messages in this group.
        </div>
      ) : recording ? (
        <div className="composer">
          <VoiceRecorder onSend={(d, mime) => void sendVoice(d, mime)} onCancel={() => setRecording(false)} onError={onError} />
        </div>
      ) : (
        <form className="composer" onSubmit={send}>
          <input ref={fileInput} type="file" hidden onChange={(e) => void onFile(e.target.files)} />
          <div className="grow">
            {replyTo && !editing && (
              <div className="editing-bar reply-bar">
                <Reply size={14} />
                <span className="grow">
                  <strong>Replying to {replyTo.outgoing ? 'yourself' : (replyTo.from ?? peer)}</strong>
                  <span className="reply-preview">{MessengerClient.preview(replyTo)}</span>
                </span>
                <button type="button" className="icon" title="Cancel reply (Esc)" onClick={() => setReplyTo(null)}>
                  <X size={15} />
                </button>
              </div>
            )}
            {editing && (
              <div className="editing-bar">
                <Pencil size={14} />
                <span className="grow">Editing message</span>
                <button
                  type="button"
                  className="icon"
                  title="Cancel (Esc)"
                  onClick={() => {
                    setEditing(null);
                    setText('');
                  }}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="field">
              {!editing && (
                <div className="attach">
                  <button
                    type="button"
                    className="icon"
                    title="Attach photo, PDF or file"
                    disabled={!canWrite}
                    onClick={() => setMenu((m) => !m)}
                  >
                    <Paperclip size={19} />
                  </button>
                  {menu && (
                    <div className="attach-menu" onMouseLeave={() => setMenu(false)}>
                      <button type="button" onClick={() => pick('image/*')}>
                        <Image size={17} /> Photo
                      </button>
                      <button type="button" onClick={() => pick('application/pdf,.pdf')}>
                        <FileText size={17} /> PDF document
                      </button>
                      <button type="button" onClick={() => pick('')}>
                        <File size={17} /> Other file
                      </button>
                      <button type="button" onClick={() => (setMenu(false), setCreating('poll'))}>
                        <BarChart3 size={17} /> Poll
                      </button>
                      <button type="button" onClick={() => (setMenu(false), setCreating('event'))}>
                        <CalendarDays size={17} /> Event
                      </button>
                      <button type="button" onClick={() => (setMenu(false), setCreating('location'))}>
                        <MapPin size={17} /> Location
                      </button>
                      <button type="button" onClick={() => (setMenu(false), setCreating('contact'))}>
                        <UserRound size={17} /> Contact
                      </button>
                      <button type="button" onClick={() => (setMenu(false), setCreating('catalog'))}>
                        <ShoppingBag size={17} /> Catalog
                      </button>
                    </div>
                  )}
                </div>
              )}
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (e.target.value && !editing) client.notifyTyping(peer);
                }}
                onKeyDown={onKey}
                placeholder={online ? 'Write a message…' : 'Offline - reconnecting…'}
                rows={1}
                autoFocus
              />
            </div>
          </div>
          {!text.trim() && !editing ? (
            <button type="button" className="primary send" disabled={!canWrite} title="Record a voice message" onClick={() => setRecording(true)}>
              <Mic size={19} />
            </button>
          ) : (
            <button className="primary send" disabled={!text.trim() || !canWrite} title={editing ? 'Save' : 'Send'}>
              {editing ? <Check size={19} /> : <SendHorizontal size={19} />}
            </button>
          )}
        </form>
      )}
    </section>
  );
}

function MessageActions({
  m,
  open,
  canEdit,
  canDeleteAll,
  canDeleteMine,
  canReply,
  canForward,
  onMenu,
  onEdit,
  onDelete,
  onReply,
  onReact,
  onForward,
  onStar,
}: {
  m: ChatMessage;
  open: boolean;
  canEdit: boolean;
  canDeleteAll: boolean;
  /** "Delete for me" (off when the admin protects chat history). */
  canDeleteMine: boolean;
  canReply: boolean;
  canForward: boolean;
  onMenu: () => void;
  onEdit: () => void;
  onDelete: (forEveryone: boolean) => void;
  onReply: () => void;
  onReact: () => void;
  onForward: () => void;
  onStar: () => void;
}) {
  return (
    <div className={`msg-actions ${m.outgoing ? 'left' : 'right'} ${open ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
      <button className="icon" title="React" onClick={onReact}>
        <SmilePlus size={14} />
      </button>
      {canReply && (
        <button className="icon" title="Reply" onClick={onReply}>
          <Reply size={14} />
        </button>
      )}
      {canForward && (
        <button className="icon" title="Forward" onClick={onForward}>
          <Forward size={14} />
        </button>
      )}
      <button className={`icon ${m.starred ? 'starred' : ''}`} title={m.starred ? 'Unstar' : 'Star'} onClick={onStar}>
        <Star size={14} />
      </button>
      {canEdit && (
        <button className="icon" title="Edit" onClick={onEdit}>
          <Pencil size={14} />
        </button>
      )}
      {(canDeleteMine || canDeleteAll) && (
        <button className="icon" title="Delete" onClick={onMenu}>
          <Trash2 size={14} />
        </button>
      )}
      {open && (
        <div className="msg-menu">
          {canDeleteMine && <button onClick={() => onDelete(false)}>Delete for me</button>}
          {canDeleteAll && (
            <button className="danger-text" onClick={() => onDelete(true)}>
              Delete for everyone
            </button>
          )}
        </div>
      )}
    </div>
  );
}
