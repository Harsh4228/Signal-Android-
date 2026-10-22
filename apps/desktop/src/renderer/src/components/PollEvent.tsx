import { useState } from 'react';
import { BarChart3, CalendarDays, Check, Clock3, MapPin, Plus, Send, Trash2, X } from 'lucide-react';
import {
  MAX_EVENT_DESC,
  MAX_EVENT_PLACE,
  MAX_EVENT_TITLE,
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  pollCounts,
  type ChatMessage,
  type Rsvp,
} from '@meetme/core';
import { client, useClient } from '../messenger';
import { errorText } from './ui';

const RSVP_LABEL: Record<Rsvp, string> = { yes: 'Going', maybe: 'Maybe', no: 'Not going' };

function eventWhen(start: number, end?: number): string {
  const d = new Date(start);
  const date = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const t = (x: number) => new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (!end) return `${date} · ${t(start)}`;
  const sameDay = new Date(end).toDateString() === d.toDateString();
  return sameDay ? `${date} · ${t(start)} – ${t(end)}` : `${date} ${t(start)} – ${new Date(end).toLocaleDateString()} ${t(end)}`;
}

/** A poll inside a chat bubble: tap options to vote; bars and counts update live for everyone. */
export function PollView({ chat, m, onError }: { chat: string; m: ChatMessage; onError: (e: string) => void }) {
  const c = useClient();
  const [showVotes, setShowVotes] = useState(false);
  const p = m.poll!;
  const me = c.account!.username;
  const mine = p.votes[me] ?? [];
  const counts = pollCounts(p);
  const voters = Object.keys(p.votes).length;
  const max = Math.max(1, ...counts);

  function toggle(i: number) {
    const next = p.multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i].sort()) : mine[0] === i ? [] : [i];
    client.votePoll(chat, m.id, next).catch((e) => onError(errorText(e)));
  }

  return (
    <div className="poll">
      <div className="poll-q">
        <BarChart3 size={16} /> {p.question}
      </div>
      <div className="muted small">{p.multi ? 'Select one or more' : 'Select one'}</div>
      <ul>
        {p.options.map((o, i) => (
          <li key={i}>
            <button className={`poll-opt ${mine.includes(i) ? 'picked' : ''}`} onClick={() => toggle(i)} disabled={c.status !== 'online'}>
              <span className={`poll-check ${p.multi ? 'square' : ''}`}>{mine.includes(i) && <Check size={12} />}</span>
              <span className="grow">
                <span className="row">
                  <span className="grow">{o}</span>
                  <span className="muted small">{counts[i]}</span>
                </span>
                <span className="poll-bar">
                  <i style={{ width: `${(counts[i]! / max) * 100}%` }} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button className="link-btn" onClick={() => setShowVotes(!showVotes)}>
        {voters} {voters === 1 ? 'person' : 'people'} voted · {showVotes ? 'Hide votes' : 'View votes'}
      </button>
      {showVotes && (
        <div className="poll-votes">
          {p.options.map((o, i) => {
            const who = Object.entries(p.votes)
              .filter(([, picks]) => picks.includes(i))
              .map(([u]) => (u === me ? 'You' : u));
            return (
              <div key={i}>
                <strong>{o}</strong> <span className="muted">({who.length})</span>
                <div className="small muted">{who.join(', ') || 'No votes'}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** An event invitation inside a chat bubble, with Going / Maybe / Not going. */
export function EventView({ chat, m, onError }: { chat: string; m: ChatMessage; onError: (e: string) => void }) {
  const c = useClient();
  const [showWho, setShowWho] = useState(false);
  const e = m.event!;
  const me = c.account!.username;
  const mine = e.rsvp[me];
  const by = (r: Rsvp) => Object.entries(e.rsvp).filter(([, x]) => x === r).map(([u]) => (u === me ? 'You' : u));
  const past = (e.end ?? e.start) < Date.now();

  return (
    <div className="event">
      <div className="event-head">
        <span className="event-date">
          <span>{new Date(e.start).toLocaleDateString([], { month: 'short' })}</span>
          <strong>{new Date(e.start).getDate()}</strong>
        </span>
        <div className="grow">
          <div className="event-title">{e.title}</div>
          <div className="muted small">
            <Clock3 size={12} /> {eventWhen(e.start, e.end)}
            {past && ' · ended'}
          </div>
          {e.place && (
            <div className="muted small">
              <MapPin size={12} /> {e.place}
            </div>
          )}
        </div>
      </div>
      {e.description && <div className="event-desc">{e.description}</div>}
      <div className="event-rsvp">
        {(['yes', 'maybe', 'no'] as const).map((r) => (
          <button
            key={r}
            className={mine === r ? 'active' : ''}
            disabled={c.status !== 'online'}
            onClick={() => client.rsvpEvent(chat, m.id, r).catch((err) => onError(errorText(err)))}
          >
            {RSVP_LABEL[r]} {by(r).length > 0 && <span className="muted small">{by(r).length}</span>}
          </button>
        ))}
      </div>
      <button className="link-btn" onClick={() => setShowWho(!showWho)}>
        {showWho ? 'Hide answers' : 'See who is coming'}
      </button>
      {showWho && (
        <div className="poll-votes">
          {(['yes', 'maybe', 'no'] as const).map((r) => (
            <div key={r}>
              <strong>{RSVP_LABEL[r]}</strong> <span className="muted">({by(r).length})</span>
              <div className="small muted">{by(r).join(', ') || 'Nobody'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NewPoll({ chat, onClose, onError }: { chat: string; onClose: () => void; onError: (e: string) => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const dupes = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;

  async function send() {
    setBusy(true);
    try {
      await client.sendPoll(chat, question, filled, multi);
      onClose();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <BarChart3 size={18} />
            </span>
            New poll
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="stack">
          <input value={question} maxLength={MAX_POLL_QUESTION} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question" autoFocus />
          <div className="section-title" style={{ margin: '8px 0 0' }}>
            Options
          </div>
          {options.map((o, i) => (
            <div key={i} className="row">
              <input
                value={o}
                maxLength={MAX_POLL_OPTION}
                placeholder={`Option ${i + 1}`}
                onChange={(e) => {
                  const next = [...options];
                  next[i] = e.target.value;
                  // Like WhatsApp: a new empty option appears once the last one is filled in.
                  if (i === next.length - 1 && e.target.value && next.length < MAX_POLL_OPTIONS) next.push('');
                  setOptions(next);
                }}
              />
              {options.length > 2 && (
                <button className="icon" title="Remove option" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
          {dupes && <div className="error">Each option must be different.</div>}
          <label className="setting">
            <span className="grow name">Allow multiple answers</span>
            <input type="checkbox" className="switch" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
          </label>
        </div>
        <div className="row-end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !question.trim() || filled.length < 2 || dupes} onClick={send}>
            <Send size={16} /> Send poll
          </button>
        </div>
      </div>
    </div>
  );
}

/** "2026-11-20T10:00" for <input type="datetime-local"> */
const localInput = (ts: number) => {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

export function NewEvent({ chat, onClose, onError }: { chat: string; onClose: () => void; onError: (e: string) => void }) {
  const nextHour = Math.ceil(Date.now() / 3600_000) * 3600_000;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState(localInput(nextHour));
  const [end, setEnd] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const startTs = new Date(start).getTime();
  const endTs = end ? new Date(end).getTime() : undefined;
  const badEnd = endTs !== undefined && endTs < startTs;

  async function send() {
    setBusy(true);
    try {
      await client.sendEvent(chat, { title, description, start: startTs, end: endTs, place });
      onClose();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <CalendarDays size={18} />
            </span>
            New event
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="stack">
          <input value={title} maxLength={MAX_EVENT_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder="Event name" autoFocus />
          <textarea
            rows={3}
            value={description}
            maxLength={MAX_EVENT_DESC}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
          <label className="field-label">
            Starts
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          {end === '' ? (
            <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setEnd(localInput(startTs + 3600_000))}>
              <Plus size={14} /> Add end time
            </button>
          ) : (
            <label className="field-label">
              Ends
              <span className="row">
                <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
                <button className="icon" title="No end time" onClick={() => setEnd('')}>
                  <X size={15} />
                </button>
              </span>
            </label>
          )}
          {badEnd && <div className="error">The end must be after the start.</div>}
          <input value={place} maxLength={MAX_EVENT_PLACE} onChange={(e) => setPlace(e.target.value)} placeholder="Location (optional)" />
        </div>
        <div className="row-end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !title.trim() || !start || Number.isNaN(startTs) || badEnd} onClick={send}>
            <Send size={16} /> Send invitation
          </button>
        </div>
      </div>
    </div>
  );
}
