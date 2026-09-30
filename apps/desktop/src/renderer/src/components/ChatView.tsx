import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ChatMessage } from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { ChatInfo } from './ChatInfo';
import { AttachmentView } from './AttachmentView';

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const TICKS: Record<NonNullable<ChatMessage['status']>, string> = {
  sending: '🕓',
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
  failed: '⚠',
};

export function ChatView({ peer, onError }: { peer: string; onError: (m: string) => void }) {
  const c = useClient();
  const [text, setText] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [verified, setVerified] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = c.getMessages(peer);
  const timer = c.getDisappearingTimer(peer);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    void client.getSafetyNumber(peer).then((s) => setVerified(!!s?.verified));
  }, [peer, showInfo, messages.length]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const t = text;
    if (!t.trim()) return;
    setText('');
    try {
      await client.sendText(peer, t);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const fileInput = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);

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
    try {
      // Read into memory only; the original file on disk is untouched and nothing new is written.
      const data = new Uint8Array(await f.arrayBuffer());
      await client.sendFile(peer, { name: f.name, mime: f.type || 'application/octet-stream', data }, caption);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  function call(video: boolean) {
    calls.startCall(peer, video).catch((err) => onError(err instanceof Error ? err.message : String(err)));
  }

  return (
    <section className="chat">
      <header>
        <div className="avatar">{peer[0]!.toUpperCase()}</div>
        <div className="grow">
          <div className="name">
            {peer} {verified && <span className="verified" title="Safety number verified">✔ verified</span>}
          </div>
          <div className="muted small">🔒 End-to-end encrypted{timer ? ' · ⏱ disappearing' : ''}</div>
        </div>
        <button className="icon" title="Voice call" onClick={() => call(false)}>
          📞
        </button>
        <button className="icon" title="Video call" onClick={() => call(true)}>
          🎥
        </button>
        <button className="icon" title="Chat info" onClick={() => setShowInfo((s) => !s)}>
          ⓘ
        </button>
      </header>

      <div className="body">
        <div className="messages">
          {messages.map((m) =>
            m.system ? (
              <div key={m.id} className="system">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className={`bubble ${m.outgoing ? 'out' : 'in'}${m.broadcast ? ' announce' : ''}`}>
                {m.broadcast && <div className="announce-label">📢 Announcement</div>}
                {m.attachment && <AttachmentView a={m.attachment} />}
                {m.text && <div className="text">{m.text}</div>}
                <div className="meta">
                  {m.expiresAt && <span title="Disappearing">⏱</span>}
                  {time(m.ts)}
                  {m.outgoing && m.status && (
                    <span className={`tick ${m.status}`} title={m.status}>
                      {TICKS[m.status]}
                    </span>
                  )}
                </div>
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
        {showInfo && <ChatInfo peer={peer} onClose={() => setShowInfo(false)} onError={onError} />}
      </div>

      <form className="composer" onSubmit={send}>
        <input ref={fileInput} type="file" hidden onChange={(e) => void onFile(e.target.files)} />
        <div className="attach">
          <button
            type="button"
            className="icon"
            title="Send photo, PDF or file"
            disabled={c.status !== 'online'}
            onClick={() => setMenu((m) => !m)}
          >
            📎
          </button>
          {menu && (
            <div className="attach-menu" onMouseLeave={() => setMenu(false)}>
              <button type="button" onClick={() => pick('image/*')}>
                🖼 Photo
              </button>
              <button type="button" onClick={() => pick('application/pdf,.pdf')}>
                📄 PDF
              </button>
              <button type="button" onClick={() => pick('')}>
                📎 File
              </button>
            </div>
          )}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={c.status === 'online' ? 'Message' : 'Offline - reconnecting…'}
          rows={1}
          autoFocus
        />
        <button className="primary round" disabled={!text.trim() || c.status !== 'online'} title="Send">
          ➤
        </button>
      </form>
    </section>
  );
}
