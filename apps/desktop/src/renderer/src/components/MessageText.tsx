import { useEffect } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { formatText, mentionPattern, shortId, type ChatMessage, type TextSpan } from '@meetme/core';
import { client, groupCalls } from '../messenger';
import { useObjectUrl, VideoPlayer } from './AttachmentView';

export function openLink(url: string) {
  // CellMate's own call / group invite links open inside the app.
  const app = client.parseAppLink(url);
  if (app) return void openAppLink(app.kind, app.group);
  if (!confirm(`Open this link in your browser?\n\n${url}`)) return;
  if (window.meetme.openLink) void window.meetme.openLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** Message text: *bold*, _italic_, ~strike~, `code`, quotes and lists (like WhatsApp), links (ask first), @mentions. */
export function MessageText({ m }: { m: ChatMessage }) {
  const tokens: string[] = [];
  for (const u of m.mentions ?? []) {
    tokens.push(`@${shortId(u)}`);
    const name = client.displayName(u);
    if (name) tokens.push(`@${name}`);
  }
  const lines = formatText(m.text, mentionPattern(tokens));
  return (
    <div className="text">
      {lines.map((l, i) => (
        <div key={i} className={`tl${l.quote ? ' tl-quote' : ''}${l.mono ? ' tl-mono' : ''}${l.bullet ? ' tl-list' : ''}`}>
          {l.bullet && <span className="tl-bullet">{l.bullet}</span>}
          {l.spans.length ? l.spans.map((sp, j) => <Span key={j} s={sp} />) : '​'}
        </div>
      ))}
    </div>
  );
}

function Span({ s }: { s: TextSpan }) {
  if (s.link) {
    return (
      <span className="msg-link" role="link" onClick={() => openLink(s.text)}>
        {s.text}
      </span>
    );
  }
  if (s.mention) return <span className="mention">{s.text}</span>;
  let el: React.ReactNode = s.text;
  if (s.code) el = <code>{el}</code>;
  if (s.strike) el = <s>{el}</s>;
  if (s.italic) el = <em>{el}</em>;
  if (s.bold) el = <strong>{el}</strong>;
  return <>{el}</>;
}

/** A view-once photo in the chat: "Click to view" once, then "Opened". */
export function ViewOnceBubble({ m, onOpen }: { m: ChatMessage; onOpen: () => void }) {
  const ready = !m.outgoing && !m.opened && !!m.attachment?.data;
  return (
    <button className="view-once" disabled={!ready} onClick={onOpen}>
      {m.opened ? <EyeOff size={18} /> : <Eye size={18} />}
      <span>
        <strong>{m.attachment?.mime.startsWith('video/') ? 'Video' : 'Photo'} · view once</strong>
        <br />
        <span className="muted small">
          {m.outgoing ? (m.opened ? 'Opened' : 'Not opened yet') : m.opened ? 'Opened' : ready ? 'Click to view' : 'Loading…'}
        </span>
      </span>
    </button>
  );
}

/** Full window, once: closing it removes the photo for good. */
export function ViewOnceViewer({ m, onClose }: { m: ChatMessage; onClose: () => void }) {
  const a = client.viewOnceFile(m);
  const url = useObjectUrl(a ?? { name: '', mime: 'image/png', size: 0, kind: 'image', state: 'ready' });
  const close = () => {
    client.closeViewOnce(m);
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), close());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div className="view-once-viewer">
      {url && a?.mime.startsWith('image/') ? (
        <img src={url} alt="" draggable={false} />
      ) : url && a?.kind === 'video' ? (
        <VideoPlayer url={url} autoPlay className="view-once-video" />
      ) : (
        <p className="hint">This file can't be shown here.</p>
      )}
      <button className="icon close" title="Close (Esc)" onClick={close}>
        <X size={22} />
      </button>
      <div className="hint">View once: it is gone when you close it</div>
    </div>
  );
}
/** A call link joins (or starts) the group's call; an invite link opens the group or asks to join it. */
async function openAppLink(kind: 'call' | 'group', group: string) {
  try {
    if (!client.groupOf(group)) {
      if (kind === 'call') return alert("You are not in this group, so you can't join its call.");
      if (!confirm('Ask to join this group? An admin approves your request.')) return;
      await client.requestToJoin(group);
      return alert('Request sent. You will see the group when an admin adds you.');
    }
    client.setActiveChat(group);
    if (kind === 'call') {
      if (groupCalls.ongoingIn(group)) await groupCalls.joinOngoing(group);
      else if (confirm('Nobody is in this call yet. Start it?')) await groupCalls.start(group, false);
    }
  } catch (e) {
    alert(String((e as Error)?.message ?? e));
  }
}
