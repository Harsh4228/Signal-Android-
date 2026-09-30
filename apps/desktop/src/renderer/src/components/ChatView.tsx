import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  BadgeCheck,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  File,
  FileText,
  Image,
  Info,
  Lock,
  Megaphone,
  Paperclip,
  Phone,
  SendHorizontal,
  ShieldAlert,
  Timer,
  Video,
} from 'lucide-react';
import type { ChatMessage } from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { ChatInfo } from './ChatInfo';
import { AttachmentView } from './AttachmentView';
import { Avatar, errorText } from './ui';

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
  const [text, setText] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [verified, setVerified] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = c.getMessages(peer);
  const timer = c.getDisappearingTimer(peer);
  const online = c.status === 'online';

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
      onError(errorText(err));
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
      onError(errorText(err));
    }
  }

  function call(video: boolean) {
    calls.startCall(peer, video).catch((err) => onError(errorText(err)));
  }

  return (
    <section className="chat">
      <header>
        <Avatar name={peer} />
        <div className="grow">
          <div className="name">
            {peer}{' '}
            {verified && (
              <span className="tag verified" title="Safety number verified">
                <BadgeCheck size={12} /> Verified
              </span>
            )}
          </div>
          <div className="sub">
            <Lock size={12} /> End-to-end encrypted
            {timer ? (
              <>
                {' · '}
                <Timer size={12} /> Disappearing messages on
              </>
            ) : null}
          </div>
        </div>
        <div className="actions">
          <button className="icon" title="Voice call" disabled={!online} onClick={() => call(false)}>
            <Phone size={19} />
          </button>
          <button className="icon" title="Video call" disabled={!online} onClick={() => call(true)}>
            <Video size={20} />
          </button>
          <button className={`icon ${showInfo ? 'active' : ''}`} title="Chat info" onClick={() => setShowInfo((s) => !s)}>
            <Info size={19} />
          </button>
        </div>
      </header>

      <div className="body">
        <div className="messages">
          {messages.map((m) =>
            m.system ? (
              <div key={m.id} className="system">
                <ShieldAlert size={13} />
                {m.text}
              </div>
            ) : (
              <div key={m.id} className={`bubble ${m.outgoing ? 'out' : 'in'}${m.broadcast ? ' announce' : ''}`}>
                {m.broadcast && (
                  <div className="announce-label">
                    <Megaphone size={13} /> Announcement
                  </div>
                )}
                {m.attachment && <AttachmentView a={m.attachment} />}
                {m.text && <div className="text">{m.text}</div>}
                <div className="meta">
                  {m.expiresAt && (
                    <span title="Disappearing message" className="tick">
                      <Timer size={12} />
                    </span>
                  )}
                  {time(m.ts)}
                  {m.outgoing && m.status && <Tick status={m.status} />}
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
        <div className="field">
          <div className="attach">
            <button
              type="button"
              className="icon"
              title="Attach photo, PDF or file"
              disabled={!online}
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
              </div>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={online ? 'Write a message…' : 'Offline - reconnecting…'}
            rows={1}
            autoFocus
          />
        </div>
        <button className="primary send" disabled={!text.trim() || !online} title="Send">
          <SendHorizontal size={19} />
        </button>
      </form>
    </section>
  );
}
