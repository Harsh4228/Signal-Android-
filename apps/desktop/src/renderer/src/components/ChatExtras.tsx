import { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  ExternalLink,
  Forward,
  Loader2,
  MapPin,
  MessageSquare,
  Mic,
  Pause,
  Play,
  Search,
  Send,
  ShoppingBag,
  Star,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import {
  MAX_PLACE_NAME,
  REACTIONS,
  mapsUrl,
  type Attachment,
  type ChatMessage,
  type ProductCard,
  type Quote,
  type SharedLocation,
} from '@meetme/core';
import { client, useClient } from '../messenger';
import { useObjectUrl } from './AttachmentView';
import { Avatar, ChatAvatar, errorText, shortTime } from './ui';

const who = (u: string) => (u === client.account?.username ? 'You' : u);

/** The message a reply answers, shown at the top of the reply. Click to jump to it. */
export function QuoteView({ q, onJump }: { q: Quote; onJump?: () => void }) {
  return (
    <button className="quote" onClick={onJump} title="Go to the message">
      <span className="quote-from">{who(q.from)}</span>
      <span className="quote-text">{q.text || 'Message'}</span>
    </button>
  );
}

/** Reactions under a bubble: each emoji once with how many, mine highlighted. */
export function ReactionChips({ chat, m, onError }: { chat: string; m: ChatMessage; onError: (e: string) => void }) {
  const me = client.account?.username ?? '';
  const entries = Object.entries(m.reactions ?? {});
  if (!entries.length) return null;
  const counts = new Map<string, string[]>();
  for (const [u, e] of entries) counts.set(e, [...(counts.get(e) ?? []), u]);
  return (
    <div className="reactions">
      {[...counts].map(([e, users]) => (
        <button
          key={e}
          className={users.includes(me) ? 'mine' : ''}
          title={users.map(who).join(', ')}
          onClick={() => client.react(chat, m.id, users.includes(me) ? null : e).catch((err) => onError(errorText(err)))}
        >
          {e} {users.length > 1 && users.length}
        </button>
      ))}
    </div>
  );
}

/** The 6 quick reactions (hover menu). */
export function ReactionPicker({ chat, m, onDone, onError }: { chat: string; m: ChatMessage; onDone: () => void; onError: (e: string) => void }) {
  const mine = m.reactions?.[client.account?.username ?? ''];
  return (
    <div className="reaction-picker" onClick={(e) => e.stopPropagation()}>
      {REACTIONS.map((e) => (
        <button
          key={e}
          className={mine === e ? 'mine' : ''}
          onClick={() => {
            onDone();
            client.react(chat, m.id, mine === e ? null : e).catch((err) => onError(errorText(err)));
          }}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export function ContactCardView({ username }: { username: string }) {
  const me = client.account?.username;
  return (
    <div className="card-msg">
      <div className="row">
        <Avatar name={username} size="sm" />
        <div className="grow">
          <div className="card-title">{client.displayName(username)}</div>
          <div className="muted small">Contact</div>
        </div>
      </div>
      {username !== me && (
        <button
          className="card-action"
          onClick={() => void client.addContact(username).then(() => client.setActiveChat(username)).catch(() => {})}
        >
          <MessageSquare size={15} /> Message
        </button>
      )}
    </div>
  );
}

export function openMaps(l: SharedLocation) {
  const url = mapsUrl(l);
  if (window.meetme.openMaps) void window.meetme.openMaps(url);
  else window.open(url, '_blank', 'noopener'); // browser dev build
}

export function LocationCardView({ l }: { l: SharedLocation }) {
  return (
    <div className="card-msg">
      <div className="row">
        <span className="loc-pin">
          <MapPin size={20} />
        </span>
        <div className="grow">
          <div className="card-title">{l.name || 'Shared location'}</div>
          <div className="muted small">
            {l.lat.toFixed(5)}, {l.lng.toFixed(5)}
          </div>
        </div>
      </div>
      <button className="card-action" onClick={() => openMaps(l)}>
        <ExternalLink size={15} /> Open in Google Maps
      </button>
    </div>
  );
}

export function ProductCardView({ p, onViewCatalog }: { p: ProductCard; onViewCatalog?: (owner: string) => void }) {
  return (
    <div className="card-msg">
      <div className="row">
        <span className="loc-pin product">
          <ShoppingBag size={20} />
        </span>
        <div className="grow">
          <div className="card-title">{p.name}</div>
          {p.price && <div className="product-price">{p.price}</div>}
        </div>
      </div>
      {p.description && <div className="muted small card-desc">{p.description}</div>}
      {p.owner && onViewCatalog && (
        <button className="card-action" onClick={() => onViewCatalog(p.owner!)}>
          <ShoppingBag size={15} /> View {p.owner === client.account?.username ? 'my' : `${p.owner}'s`} catalog
        </button>
      )}
    </div>
  );
}

/** Voice message: play / pause, progress and length. Played from memory only. */
export function AudioView({ a }: { a: Attachment }) {
  const url = useObjectUrl(a);
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [len, setLen] = useState(0);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  if (!url) {
    return (
      <div className="voice">
        <Loader2 size={18} className="spin" /> <span className="muted small">{a.state === 'failed' ? 'Voice message unavailable' : 'Loading…'}</span>
      </div>
    );
  }
  return (
    <div className="voice">
      <audio
        ref={ref}
        src={url}
        preload="metadata"
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLen(e.currentTarget.duration)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onEnded={() => (setPlaying(false), setPos(0))}
      />
      <button
        className="icon voice-play"
        title={playing ? 'Pause' : 'Play'}
        onClick={() => {
          const el = ref.current!;
          if (playing) el.pause();
          else void el.play();
          setPlaying(!playing);
        }}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <span className="voice-track">
        <i style={{ width: `${len ? (pos / len) * 100 : 0}%` }} />
      </span>
      <span className="muted small">{fmt(playing || pos ? pos : len)}</span>
      <Mic size={14} className="muted" />
    </div>
  );
}

/** Hold-free voice recorder: tap the mic to start, then send or cancel. Audio stays in memory. */
export function VoiceRecorder({ onSend, onCancel, onError }: { onSend: (data: Uint8Array, mime: string) => void; onCancel: () => void; onError: (e: string) => void }) {
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const send = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        stream = s;
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const r = new MediaRecorder(s, { mimeType: mime });
        rec.current = r;
        r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
        r.onstop = async () => {
          stream?.getTracks().forEach((t) => t.stop());
          if (!send.current) return;
          const blob = new Blob(chunks.current, { type: 'audio/webm' });
          onSend(new Uint8Array(await blob.arrayBuffer()), 'audio/webm');
        };
        r.start(250);
        timer = setInterval(() => setSecs((x) => x + 1), 1000);
      })
      .catch(() => {
        onError('Microphone not available');
        onCancel();
      });
    return () => {
      clearInterval(timer);
      if (rec.current?.state === 'recording') rec.current.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (secs >= 300) finish(true); // 5 minutes max
  }, [secs]);

  function finish(ok: boolean) {
    send.current = ok;
    if (rec.current?.state === 'recording') rec.current.stop();
    if (!ok) onCancel();
  }

  return (
    <div className="recorder">
      <button type="button" className="icon danger" title="Cancel" onClick={() => finish(false)}>
        <Trash2 size={18} />
      </button>
      <span className="rec-dot" />
      <span className="grow">
        Recording {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </span>
      <button type="button" className="primary send" title="Send voice message" onClick={() => finish(true)} disabled={secs < 1}>
        <Send size={18} />
      </button>
    </div>
  );
}

function Modal({ title, icon, onClose, children, wide }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">{icon}</span>
            {title}
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Pick a location: the device's current position, or typed in (coordinates or a pasted Google Maps link). */
export function LocationPicker({ chat, onClose, onError }: { chat: string; onClose: () => void; onError: (e: string) => void }) {
  const [name, setName] = useState('');
  const [coords, setCoords] = useState('');
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);

  // "19.0760, 72.8777", or a maps link containing "@19.07,72.87" / "query=19.07,72.87" / "q=19.07,72.87"
  const parsed = (() => {
    const m = coords.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (!m) return null;
    const [lat, lng] = [Number(m[1]), Number(m[2])];
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
  })();

  function locate() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCoords(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);
        setLocating(false);
      },
      () => {
        setLocating(false);
        onError("Couldn't get this computer's location. Turn on Windows location, or paste coordinates or a Google Maps link.");
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function send() {
    if (!parsed) return;
    setBusy(true);
    try {
      await client.sendLocation(chat, { ...parsed, name: name.trim() || undefined });
      onClose();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal title="Share location" icon={<MapPin size={18} />} onClose={onClose}>
      <p className="intro">The location is sent end-to-end encrypted. No map service is contacted unless someone taps "Open in Google Maps".</p>
      <div className="stack">
        <button onClick={locate} disabled={locating}>
          {locating ? <Loader2 size={16} className="spin" /> : <Crosshair size={16} />} Use my current location
        </button>
        <label className="field-label">
          Coordinates or Google Maps link
          <input value={coords} onChange={(e) => setCoords(e.target.value)} placeholder="19.0760, 72.8777" />
        </label>
        {coords && !parsed && <div className="error">Enter latitude, longitude like 19.0760, 72.8777 (or paste a Google Maps link).</div>}
        <label className="field-label">
          Place name (optional)
          <input value={name} maxLength={MAX_PLACE_NAME} onChange={(e) => setName(e.target.value)} placeholder="e.g. Head office, Gate 2" />
        </label>
      </div>
      <div className="row-end">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!parsed || busy} onClick={send}>
          <Send size={16} /> Send location
        </button>
      </div>
    </Modal>
  );
}

/** Pick a colleague to share as a contact card. */
export function ContactPicker({ chat, onClose, onError }: { chat: string; onClose: () => void; onError: (e: string) => void }) {
  const c = useClient();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<string[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim()) client.searchUsers(q).then(setFound).catch(() => setFound([]));
      else setFound([]);
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const me = c.account?.username;
  const list = q.trim() ? found : c.contacts.filter((u) => u !== chat && u !== me);

  async function share(u: string) {
    try {
      await client.sendContact(chat, u);
      onClose();
    } catch (e) {
      onError(errorText(e));
    }
  }

  return (
    <Modal title="Share contact" icon={<UserRound size={18} />} onClose={onClose}>
      <div className="search">
        <Search size={16} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search colleagues" autoFocus />
      </div>
      <ul className="emp-list forward-list">
        {!list.length && <li className="muted">{q.trim() ? 'Nobody found' : 'No contacts yet. Search by name.'}</li>}
        {list.map((u) => (
          <li key={u} className="clickable" onClick={() => void share(u)}>
            <Avatar name={u} />
            <div className="grow name">{client.displayName(u)}</div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Forward a message to one or more chats. */
export function ForwardPicker({ m, onClose, onToast }: { m: ChatMessage; onClose: () => void; onToast: (e: string) => void }) {
  const c = useClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const keys = c.chatKeys().filter((k) => c.canSendTo(k));

  async function send() {
    setBusy(true);
    const results = await Promise.allSettled(picked.map((k) => client.forwardMessage(k, m)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    onToast(failed ? `Forwarded to ${picked.length - failed}; ${failed} failed` : `Forwarded to ${picked.length} chat${picked.length === 1 ? '' : 's'}`);
    onClose();
  }

  return (
    <Modal title="Forward to…" icon={<Forward size={18} />} onClose={onClose}>
      <ul className="emp-list forward-list pick-list">
        {!keys.length && <li className="muted">No chats yet.</li>}
        {keys.map((k) => (
          <li key={k} onClick={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>
            <input type="checkbox" checked={picked.includes(k)} readOnly />
            <ChatAvatar chatKey={k} />
            <div className="grow name">{c.chatTitle(k)}</div>
          </li>
        ))}
      </ul>
      <div className="row-end">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!picked.length || busy} onClick={send}>
          <Forward size={16} /> Forward{picked.length > 1 ? ` (${picked.length})` : ''}
        </button>
      </div>
    </Modal>
  );
}

/** Every starred message; click one to open its chat. */
export function StarredPanel({ onClose }: { onClose: () => void }) {
  const c = useClient();
  const list = c.starredMessages();
  return (
    <Modal title="Starred messages" icon={<Star size={18} />} onClose={onClose} wide>
      {!list.length ? (
        <div className="notice-empty muted">
          <Star size={28} color="var(--faint)" />
          <div>No starred messages</div>
          <div className="small">Hover a message and click ☆ to keep it here.</div>
        </div>
      ) : (
        <ul className="emp-list forward-list">
          {list.map((s) => (
            <li
              key={`${s.chat}:${s.msgId}`}
              className="clickable"
              onClick={() => {
                client.setActiveChat(s.chat);
                onClose();
              }}
            >
              <ChatAvatar chatKey={s.chat} />
              <div className="grow">
                <div className="name">
                  {who(s.from)} <span className="muted small">· {c.chatTitle(s.chat)}</span>
                </div>
                <div className="small starred-preview">{s.preview}</div>
              </div>
              <span className="muted small">{shortTime(s.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
