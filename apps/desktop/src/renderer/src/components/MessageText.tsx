import { useEffect } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { LINK_RE, shortId, type ChatMessage } from '@meetme/core';
import { client } from '../messenger';
import { useObjectUrl } from './AttachmentView';

function openLink(url: string) {
  if (!confirm(`Open this link in your browser?\n\n${url}`)) return;
  if (window.meetme.openLink) void window.meetme.openLink(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** Message text with clickable links (asks first) and highlighted @mentions. */
export function MessageText({ m }: { m: ChatMessage }) {
  const tokens: string[] = [];
  for (const u of m.mentions ?? []) {
    tokens.push(`@${shortId(u)}`);
    const name = client.displayName(u);
    if (name) tokens.push(`@${name}`);
  }
  const mention = tokens.length ? new RegExp(`(${tokens.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi') : null;
  const parts: { text: string; link?: boolean }[] = [];
  let last = 0;
  for (const match of m.text.matchAll(LINK_RE)) {
    if (match.index! > last) parts.push({ text: m.text.slice(last, match.index) });
    parts.push({ text: match[0], link: true });
    last = match.index! + match[0].length;
  }
  if (last < m.text.length) parts.push({ text: m.text.slice(last) });
  return (
    <div className="text">
      {parts.map((p, i) =>
        p.link ? (
          <span key={i} className="msg-link" role="link" onClick={() => openLink(p.text)}>
            {p.text}
          </span>
        ) : mention ? (
          p.text.split(mention).map((piece, j) =>
            j % 2 ? (
              <span key={`${i}-${j}`} className="mention">
                {piece}
              </span>
            ) : (
              piece
            ),
          )
        ) : (
          p.text
        ),
      )}
    </div>
  );
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
      {url && a?.mime.startsWith('image/') ? <img src={url} alt="" draggable={false} /> : <p className="hint">This file can't be shown here.</p>}
      <button className="icon close" title="Close (Esc)" onClick={close}>
        <X size={22} />
      </button>
      <div className="hint">View once: it is gone when you close it</div>
    </div>
  );
}