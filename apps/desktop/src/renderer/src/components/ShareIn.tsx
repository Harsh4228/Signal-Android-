import { useState } from 'react';
import { File, FileText, Image as ImageIcon, Mic, Search, Send, Video, X } from 'lucide-react';
import { MAX_ATTACHMENT_BYTES, formatBytes } from '@meetme/core';
import { client, useClient } from '../messenger';
import type { SharedIn } from '../shareIn';
import { ChatAvatar, errorText } from './ui';

const iconFor = (mime: string) =>
  mime.startsWith('image/') ? ImageIcon : mime.startsWith('video/') ? Video : mime.startsWith('audio/') ? Mic : mime === 'application/pdf' ? FileText : File;

/**
 * Something was shared to CellMate from outside (the web app on Android, or Windows "Send to"): choose the chats and
 * send it end-to-end encrypted. Follows the admin's "Send photos & files" right and group sender rules.
 */
export function ShareInModal({ shared, onClose, onToast }: { shared: SharedIn; onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState(shared.text);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const files = shared.files;
  const ok = files.filter((f) => f.data.length <= MAX_ATTACHMENT_BYTES);
  const q = query.trim().toLowerCase();
  const keys = c
    .orderedChats()
    .filter((k) => c.canSendTo(k) && (!files.length || c.can('sendFiles', k)))
    .filter((k) => !q || c.chatTitle(k).toLowerCase().includes(q));

  async function send() {
    setBusy(true);
    const message = text.trim();
    let failed = 0;
    for (const key of picked) {
      try {
        // The message goes with the first file as its caption, or on its own.
        for (let i = 0; i < ok.length; i++) await client.sendFile(key, ok[i]!, i === 0 ? message : '');
        if (!ok.length && message) await client.sendText(key, message);
      } catch {
        failed++;
      }
    }
    onToast(failed ? `Sent to ${picked.length - failed}; ${failed} failed` : `Sent to ${picked.length} chat${picked.length === 1 ? '' : 's'}`);
    if (picked.length === 1 && !failed) client.setActiveChat(picked[0]!);
    onClose();
  }

  const nothing = !ok.length && !text.trim();
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal share-in" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Send size={18} />
            </span>
            Send to…
          </div>
          <button className="icon" onClick={onClose} title="Cancel">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body stack" style={{ gap: 10 }}>
          {files.length > 0 && (
            <ul className="share-files">
              {files.slice(0, 6).map((f, i) => {
                const Icon = iconFor(f.mime);
                const big = f.data.length > MAX_ATTACHMENT_BYTES;
                return (
                  <li key={i} className={big ? 'danger-text' : undefined}>
                    <Icon size={16} />
                    <span className="grow">{f.name}</span>
                    <span className="small muted">{big ? `over ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB, not sent` : formatBytes(f.data.length)}</span>
                  </li>
                );
              })}
              {files.length > 6 && <li className="muted small">and {files.length - 6} more</li>}
            </ul>
          )}
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={files.length ? 'Add a message (optional)' : 'Message'} />
          <div className="search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" autoFocus />
          </div>
          <ul className="emp-list forward-list pick-list" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {!keys.length && <li className="muted">No chats you can send this to.</li>}
            {keys.map((k) => (
              <li key={k} onClick={() => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))}>
                <input type="checkbox" checked={picked.includes(k)} readOnly />
                <ChatAvatar chatKey={k} />
                <div className="grow name">{c.chatTitle(k)}</div>
              </li>
            ))}
          </ul>
          <div className="row-end" style={{ marginTop: 0 }}>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" disabled={!picked.length || nothing || busy} onClick={() => void send().catch((e) => onToast(errorText(e)))}>
              <Send size={16} /> Send{picked.length > 1 ? ` to ${picked.length} chats` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
