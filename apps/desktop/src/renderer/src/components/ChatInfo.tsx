import { useEffect, useState } from 'react';
import { client, useClient } from '../messenger';

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

  const run = (fn: () => Promise<unknown>) => () => fn().then(reload).catch((e) => onError(String(e?.message ?? e)));

  return (
    <aside className="info">
      <header>
        <b>Chat info</b>
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </header>

      <h4>Safety number</h4>
      {safety ? (
        <>
          <pre className="safety">{safety.number}</pre>
          <p className="muted small">
            Compare these numbers with {peer} in person or on a call. If they match, nobody can be listening in.
          </p>
          <button onClick={run(() => client.setVerified(peer, !safety.verified))}>
            {safety.verified ? 'Clear verification' : 'Mark as verified'}
          </button>
        </>
      ) : (
        <p className="muted small">Send or receive a message first to set up the secure session.</p>
      )}

      <h4>Disappearing messages</h4>
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

      <h4>Privacy</h4>
      <button onClick={() => client.clearChat(peer)}>Clear chat from memory</button>
      <button onClick={run(() => client.resetSession(peer))}>Reset secure session</button>
      <button
        className="danger"
        onClick={() => {
          if (confirm(`Remove ${peer} and delete the chat?`)) {
            client.setActiveChat(null);
            void client.removeContact(peer);
          }
        }}
      >
        Remove contact
      </button>
    </aside>
  );
}
