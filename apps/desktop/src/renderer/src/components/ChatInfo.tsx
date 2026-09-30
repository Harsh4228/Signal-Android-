import { useEffect, useState } from 'react';
import { BadgeCheck, Eraser, RotateCcw, ShieldX, UserMinus, X } from 'lucide-react';
import { client, useClient } from '../messenger';
import { Avatar, errorText } from './ui';

const TIMERS: [number, string][] = [
  [0, 'Off'],
  [30, '30 seconds'],
  [300, '5 minutes'],
  [3600, '1 hour'],
  [86400, '1 day'],
  [604800, '1 week'],
];

export function ChatInfo({ peer, onClose, onError }: { peer: string; onClose: () => void; onError: (m: string) => void }) {
  const c = useClient();
  const [safety, setSafety] = useState<{ number: string; verified: boolean } | null>(null);

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
      </div>

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

      <div className="section-title">Privacy</div>
      <div className="stack">
        <button onClick={() => client.clearChat(peer)}>
          <Eraser size={16} /> Clear chat from memory
        </button>
        <button onClick={run(() => client.resetSession(peer))}>
          <RotateCcw size={16} /> Reset secure session
        </button>
        <button
          className="danger"
          onClick={() => {
            if (confirm(`Remove ${peer} and delete the chat?`)) {
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
