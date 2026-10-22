import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleDashed, Eye, ImagePlus, Loader2, Palette, Send, Trash2, Type, X } from 'lucide-react';
import { MAX_STATUS_TEXT, STATUS_COLORS, type OutgoingFile, type StatusUpdate } from '@meetme/core';
import { client, useClient } from '../messenger';
import { Avatar, errorText, shortTime } from './ui';

const SHOW_MS = 5000;

/** "12 min ago", "Today 14:05", "Yesterday 09:10" */
function ago(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const d = new Date(ts);
  const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `Today ${hhmm}` : `Yesterday ${hhmm}`;
}

/** Avatar with WhatsApp's ring: one segment per status, grey once viewed. */
function Ring({ name, count, seen }: { name: string; count: number; seen: number }) {
  const r = 23;
  const c = 2 * Math.PI * r;
  const gap = count > 1 ? 4 : 0;
  const seg = c / count;
  return (
    <span className="status-ring">
      <svg width="52" height="52" viewBox="0 0 52 52">
        {Array.from({ length: count }, (_, i) => (
          <circle
            key={i}
            cx="26"
            cy="26"
            r={r}
            fill="none"
            strokeWidth="2.5"
            stroke={i < seen ? 'var(--line-strong)' : 'var(--ok)'}
            strokeDasharray={`${seg - gap} ${c - seg + gap}`}
            strokeDashoffset={-i * seg + c / 4}
          />
        ))}
      </svg>
      <Avatar name={name} />
    </span>
  );
}

/** Status: my updates, and my contacts' updates of the last 24 hours. */
export function StatusPanel({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [composing, setComposing] = useState<'text' | 'photo' | null>(null);
  const [viewing, setViewing] = useState<{ user: string; start: number } | null>(null);
  const me = c.account!.username;
  const mine = c.myStatuses();
  const groups = c.statusGroups();
  const recent = groups.filter((g) => !g.allSeen);
  const viewed = groups.filter((g) => g.allSeen);
  const offline = c.status !== 'online';

  const open = (user: string) => {
    const g = groups.find((x) => x.user === user);
    // Start at the first one not viewed yet, like WhatsApp.
    const first = g ? Math.max(0, g.items.findIndex((s) => !s.seen)) : 0;
    setViewing({ user, start: g?.allSeen ? 0 : first });
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal status-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <CircleDashed size={18} />
            </span>
            Status
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>

        <ul className="status-list">
          <li className={mine.length ? 'clickable' : ''} onClick={() => mine.length && setViewing({ user: me, start: 0 })}>
            {mine.length ? <Ring name={me} count={mine.length} seen={mine.length} /> : <Avatar name={me} />}
            <div className="grow">
              <div className="name">My status</div>
              <div className="muted small">
                {mine.length ? `${mine.length} update${mine.length === 1 ? '' : 's'} · ${ago(mine[mine.length - 1]!.ts)}` : 'Share a text or photo for 24 hours'}
              </div>
            </div>
            <span className="row" onClick={(e) => e.stopPropagation()}>
              <button className="icon" title="Text status" disabled={offline} onClick={() => setComposing('text')}>
                <Type size={18} />
              </button>
              <button className="icon" title="Photo status" disabled={offline} onClick={() => setComposing('photo')}>
                <ImagePlus size={18} />
              </button>
            </span>
          </li>
        </ul>

        {recent.length > 0 && <div className="section-title">Recent updates</div>}
        <ul className="status-list">
          {recent.map((g) => (
            <PersonRow key={g.user} user={g.user} items={g.items} onOpen={() => open(g.user)} />
          ))}
        </ul>
        {viewed.length > 0 && <div className="section-title">Viewed updates</div>}
        <ul className="status-list">
          {viewed.map((g) => (
            <PersonRow key={g.user} user={g.user} items={g.items} onOpen={() => open(g.user)} />
          ))}
        </ul>
        {!groups.length && (
          <p className="muted small" style={{ marginTop: 16 }}>
            No updates from your contacts yet. Statuses disappear after 24 hours.
          </p>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          Your status goes to your contacts and the people in your groups, end-to-end encrypted.
        </p>
      </div>
      {composing && (
        <StatusComposer
          mode={composing}
          onClose={() => setComposing(null)}
          onDone={(m) => {
            setComposing(null);
            onToast(m);
          }}
          onToast={onToast}
        />
      )}
      {viewing && (
        <StatusViewer
          user={viewing.user}
          start={viewing.start}
          onClose={() => setViewing(null)}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function PersonRow({ user, items, onOpen }: { user: string; items: StatusUpdate[]; onOpen: () => void }) {
  return (
    <li className="clickable" onClick={onOpen}>
      <Ring name={user} count={items.length} seen={items.filter((s) => s.seen).length} />
      <div className="grow">
        <div className="name">{user}</div>
        <div className="muted small">{ago(items[items.length - 1]!.ts)}</div>
      </div>
    </li>
  );
}

function StatusComposer({
  mode,
  onClose,
  onDone,
  onToast,
}: {
  mode: 'text' | 'photo';
  onClose: () => void;
  onDone: (m: string) => void;
  onToast: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [bg, setBg] = useState(STATUS_COLORS[0]!);
  const [photo, setPhoto] = useState<OutgoingFile | null>(null);
  const [busy, setBusy] = useState(false);
  const url = useMemo(() => (photo ? URL.createObjectURL(new Blob([photo.data as BlobPart], { type: photo.mime })) : null), [photo]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  async function pick(f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('image/')) return onToast('Pick a photo');
    setPhoto({ name: f.name, mime: f.type, data: new Uint8Array(await f.arrayBuffer()) });
  }

  async function send() {
    setBusy(true);
    try {
      const r = await client.postStatus(mode === 'photo' && photo ? { photo, caption: text } : { text, bg });
      onDone(`Status shared with ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`);
    } catch (e) {
      onToast(errorText(e));
      setBusy(false);
    }
  }

  const ready = mode === 'photo' ? !!photo : !!text.trim();
  return (
    <div className="status-stage" onClick={onClose}>
      <div className="status-compose" onClick={(e) => e.stopPropagation()}>
        <header>
          <button className="icon light" onClick={onClose} title="Cancel">
            <X size={20} />
          </button>
          <div className="grow" />
          {mode === 'text' && (
            <button
              className="icon light"
              title="Background colour"
              onClick={() => setBg(STATUS_COLORS[(STATUS_COLORS.indexOf(bg) + 1) % STATUS_COLORS.length]!)}
            >
              <Palette size={20} />
            </button>
          )}
        </header>
        {mode === 'text' ? (
          <div className="status-card text" style={{ background: bg }}>
            <textarea
              value={text}
              maxLength={MAX_STATUS_TEXT}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a status"
              autoFocus
            />
          </div>
        ) : (
          <div className="status-card photo">
            {url ? (
              <img src={url} alt="" draggable={false} />
            ) : (
              <label className="status-pick">
                <ImagePlus size={32} />
                <span>Choose a photo</span>
                <input type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
              </label>
            )}
          </div>
        )}
        <div className="status-send">
          {mode === 'photo' && (
            <input value={text} maxLength={MAX_STATUS_TEXT} onChange={(e) => setText(e.target.value)} placeholder="Add a caption…" />
          )}
          <button className="primary" disabled={busy || !ready} onClick={send}>
            {busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Share
          </button>
        </div>
      </div>
    </div>
  );
}

/** Full-screen player: each update for 5 seconds with progress bars; click left / right to go back / on. */
function StatusViewer({ user, start, onClose, onToast }: { user: string; start: number; onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const mineView = user === c.account?.username;
  const items = mineView ? c.myStatuses() : (c.statusGroups().find((g) => g.user === user)?.items ?? []);
  const [index, setIndex] = useState(start);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const s = items[Math.min(index, items.length - 1)];

  const [photo, setPhoto] = useState<string | null>(null);
  useEffect(() => {
    setPhoto(null);
    if (!s?.photo) return;
    let url: string | null = null;
    let gone = false;
    client
      .statusPhoto(s)
      .then((data) => {
        if (gone) return;
        url = URL.createObjectURL(new Blob([data as BlobPart], { type: s.photo!.mime }));
        setPhoto(url);
      })
      .catch((e) => !gone && onToast(errorText(e)));
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [s?.id]);

  // Mark viewed as soon as it is on screen.
  useEffect(() => {
    if (s && !s.outgoing) client.markStatusSeen(s.id, s.from);
    setElapsed(0);
  }, [s?.id]);

  const loading = !!s?.photo && !photo;
  const hold = paused || showViewers || loading;
  useEffect(() => {
    if (hold || !s) return;
    const t = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => clearInterval(t);
  }, [hold, s?.id]);

  const next = () => (index + 1 < items.length ? setIndex(index + 1) : onClose());
  const prev = () => setIndex(Math.max(0, index - 1));
  useEffect(() => {
    if (elapsed >= SHOW_MS) next();
  }, [elapsed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Every update deleted or expired while watching.
  useEffect(() => {
    if (!s) onClose();
  }, [s]);
  if (!s) return null;

  const viewers = Object.entries(s.viewers ?? {}).sort((a, b) => b[1] - a[1]);

  async function remove() {
    if (!confirm('Delete this status for everyone?')) return;
    try {
      await client.deleteStatus(s!.id);
    } catch (e) {
      onToast(errorText(e));
    }
  }

  return (
    <div className="status-stage" onClick={onClose}>
      <div
        className="status-player"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={() => setPaused(true)}
        onMouseUp={() => setPaused(false)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="status-bars">
          {items.map((x, i) => (
            <span key={x.id}>
              <i style={{ width: `${i < index ? 100 : i === index ? Math.min(100, (elapsed / SHOW_MS) * 100) : 0}%` }} />
            </span>
          ))}
        </div>
        <header>
          <Avatar name={user} size="sm" />
          <div className="grow">
            <div className="name">{mineView ? 'My status' : user}</div>
            <div className="small">{ago(s.ts)}</div>
          </div>
          {mineView && (
            <button className="icon light" title="Delete for everyone" onClick={() => void remove()}>
              <Trash2 size={18} />
            </button>
          )}
          <button className="icon light" title="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        {s.photo ? (
          <div className="status-card photo">
            {photo ? <img src={photo} alt="" draggable={false} /> : <Loader2 size={28} className="spin" />}
          </div>
        ) : (
          <div className="status-card text" style={{ background: s.bg ?? STATUS_COLORS[0] }}>
            <div className="status-text">{s.text}</div>
          </div>
        )}
        {s.photo && s.text && <div className="status-caption">{s.text}</div>}

        <button className="status-nav left" onClick={prev} title="Previous" disabled={index === 0}>
          <ChevronLeft size={22} />
        </button>
        <button className="status-nav right" onClick={next} title="Next">
          <ChevronRight size={22} />
        </button>

        {mineView && (
          <div className="status-viewers">
            <button className="light-btn" onClick={() => setShowViewers(!showViewers)}>
              <Eye size={16} /> Seen by {viewers.length} of {s.audience?.length ?? 0}
            </button>
            {showViewers && (
              <ul>
                {viewers.length ? (
                  viewers.map(([u, ts]) => (
                    <li key={u}>
                      <Avatar name={u} size="sm" />
                      <span className="grow">{u}</span>
                      <span className="muted small">{shortTime(ts)}</span>
                    </li>
                  ))
                ) : (
                  <li className="muted small">No views yet</li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
