import { useEffect, useState } from 'react';
import { formatBytes, type OutgoingFile } from '@meetme/core';
import { client } from '../messenger';

export function Broadcast({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const [text, setText] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<OutgoingFile | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFile({ name: f.name, mime: f.type || 'application/octet-stream', data: new Uint8Array(await f.arrayBuffer()) });
  }

  useEffect(() => {
    client
      .listActiveRecipients()
      .then((u) => setCount(u.length))
      .catch(() => setCount(null));
  }, []);

  async function send() {
    setBusy(true);
    try {
      const r = await client.broadcast(text, file ?? undefined);
      onDone(
        r.failed.length
          ? `Sent to ${r.sent}. Failed: ${r.failed.join(', ')}`
          : `📢 Announcement sent to ${r.sent} employee${r.sent === 1 ? '' : 's'}`,
      );
      onClose();
    } catch (e) {
      onDone(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>📢 Announcement to all employees</b>
          <button className="icon" onClick={onClose}>
            ✕
          </button>
        </header>
        <p className="muted small">
          {count === null ? 'Loading employees…' : `Goes to ${count} employee${count === 1 ? '' : 's'}.`} Each copy is
          end-to-end encrypted separately. Replies come back to you as private chats.
        </p>
        <textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type the announcement…"
          autoFocus
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <label className="file-btn">
            📎 {file ? `${file.name} (${formatBytes(file.data.length)})` : 'Attach photo / PDF / file'}
            <input type="file" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {file && (
            <button className="icon" title="Remove file" onClick={() => setFile(null)}>
              ✕
            </button>
          )}
          <div className="grow" />
          <button className="primary" disabled={busy || (!text.trim() && !file) || !count} onClick={send}>
            {busy ? 'Sending…' : 'Send to everyone'}
          </button>
        </div>
      </div>
    </div>
  );
}
