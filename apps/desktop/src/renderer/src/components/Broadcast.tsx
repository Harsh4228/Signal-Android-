import { useEffect, useState } from 'react';
import { Megaphone, Paperclip, Send, X } from 'lucide-react';
import { formatBytes, type OutgoingFile } from '@meetme/core';
import { client } from '../messenger';
import { errorText } from './ui';

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
          : `Announcement sent to ${r.sent} employee${r.sent === 1 ? '' : 's'}`,
      );
      onClose();
    } catch (e) {
      onDone(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Megaphone size={18} />
            </span>
            New announcement
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <p className="intro">
          {count === null ? 'Loading employees…' : `Goes to ${count} employee${count === 1 ? '' : 's'}.`} Each copy is
          end-to-end encrypted separately. Replies come back to you as private chats.
        </p>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write your announcement…"
          autoFocus
        />
        <div className="row" style={{ marginTop: 12 }}>
          <label className="file-btn">
            <Paperclip size={16} />
            <span>{file ? `${file.name} (${formatBytes(file.data.length)})` : 'Attach photo, PDF or file'}</span>
            <input type="file" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {file && (
            <button className="icon" title="Remove file" onClick={() => setFile(null)}>
              <X size={16} />
            </button>
          )}
          <div className="grow" />
          <button className="primary" disabled={busy || (!text.trim() && !file) || !count} onClick={send}>
            <Send size={16} />
            {busy ? 'Sending…' : 'Send to everyone'}
          </button>
        </div>
      </div>
    </div>
  );
}
