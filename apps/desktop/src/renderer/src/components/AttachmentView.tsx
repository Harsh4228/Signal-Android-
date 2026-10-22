import { useEffect, useMemo, useRef, useState } from 'react';
import { File, FileText, Forward, Image, Loader2, Lock, TriangleAlert, X } from 'lucide-react';
import { formatBytes, type Attachment } from '@meetme/core';
import { client, useClient } from '../messenger';
import { ChatAvatar, errorText } from './ui';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** In-memory object URL (blob:) - the bytes never touch the disk. */
export function useObjectUrl(a: Attachment): string | null {
  const url = useMemo(
    () => (a.data ? URL.createObjectURL(new Blob([a.data as BlobPart], { type: a.mime })) : null),
    [a.data, a.mime],
  );
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

function KindIcon({ kind }: { kind: Attachment['kind'] }) {
  const Icon = kind === 'image' ? Image : kind === 'pdf' ? FileText : File;
  return (
    <span className={`att-icon ${kind}`}>
      <Icon size={20} />
    </span>
  );
}

/** Share to another chat inside CellMate (everyone may). There is no way to save a file outside the app. */
export function FileActions({ a, onToast, compact }: { a: Attachment; onToast: (m: string) => void; compact?: boolean }) {
  const [forwarding, setForwarding] = useState(false);
  if (!a.data) return null;

  return (
    <>
      <span className={`att-actions ${compact ? 'compact' : ''}`} onClick={(e) => e.stopPropagation()}>
        <button className="icon" title="Share to another chat" onClick={() => setForwarding(true)}>
          <Forward size={16} />
        </button>
      </span>
      {forwarding && <ForwardPicker a={a} onClose={() => setForwarding(false)} onToast={onToast} />}
    </>
  );
}

function ForwardPicker({ a, onClose, onToast }: { a: Attachment; onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function send(key: string) {
    setBusy(key);
    try {
      await client.forwardAttachment(key, a);
      onToast(`Shared ${a.name} with ${c.chatTitle(key)}`);
      onClose();
    } catch (e) {
      onToast(errorText(e));
      setBusy(null);
    }
  }

  return (
    <div className="modal-bg" onClick={(e) => (e.stopPropagation(), onClose())}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Forward size={18} />
            </span>
            Share {a.name}
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <p className="intro">Pick a chat. The file is encrypted again for that chat.</p>
        <ul className="emp-list forward-list">
          {!c.chatKeys().length && <li className="muted">No chats yet.</li>}
          {c.chatKeys().map((key) => (
            <li key={key} className="clickable" onClick={() => !busy && void send(key)}>
              <ChatAvatar chatKey={key} />
              <div className="grow name">{c.chatTitle(key)}</div>
              {busy === key && <Loader2 size={16} className="spin" />}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AttachmentView({ a, onToast }: { a: Attachment; onToast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const url = useObjectUrl(a);

  if (a.state === 'downloading' || a.state === 'uploading') {
    return (
      <div className="att-card">
        <span className="att-icon">
          <Loader2 size={20} className="spin" />
        </span>
        <div className="grow">
          <div className="att-name">{a.name}</div>
          <div className="muted small">{a.state === 'uploading' ? 'Encrypting and sending…' : 'Decrypting…'}</div>
        </div>
      </div>
    );
  }
  if (a.state === 'failed' || !a.data) {
    return (
      <div className="att-card">
        <span className="att-icon warn">
          <TriangleAlert size={20} />
        </span>
        <div className="grow">
          <div className="att-name">{a.name}</div>
          <div className="muted small">File unavailable (expired or failed)</div>
        </div>
      </div>
    );
  }

  if (a.kind === 'image' && url) {
    return (
      <>
        <span className="att-image-wrap">
          <img className="att-image" src={url} alt="" draggable={false} onClick={() => setOpen(true)} />
          <FileActions a={a} onToast={onToast} compact />
        </span>
        {open && (
          <Viewer title={a.name} onClose={() => setOpen(false)} actions={<FileActions a={a} onToast={onToast} />}>
            <img className="viewer-image" src={url} alt="" draggable={false} />
          </Viewer>
        )}
      </>
    );
  }

  const openable = a.kind === 'pdf';
  return (
    <>
      <div
        className={`att-card ${openable ? 'clickable' : ''}`}
        onClick={() => openable && setOpen(true)}
        title={openable ? 'Open' : 'This file type cannot be opened inside CellMate'}
      >
        <KindIcon kind={a.kind} />
        <div className="grow">
          <div className="att-name">{a.name}</div>
          <div className="muted small">
            {formatBytes(a.size)} · {openable ? 'Click to view' : 'Preview not available'}
          </div>
        </div>
        <FileActions a={a} onToast={onToast} />
      </div>
      {open && a.kind === 'pdf' && (
        <Viewer title={a.name} onClose={() => setOpen(false)} actions={<FileActions a={a} onToast={onToast} />}>
          <PdfPages data={a.data} />
        </Viewer>
      )}
    </>
  );
}

export function Viewer({
  title,
  onClose,
  actions,
  children,
}: {
  title: string;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="viewer" onClick={onClose}>
      <header onClick={(e) => e.stopPropagation()}>
        <span className="att-name">{title}</span>
        <span className="hint">
          <Lock size={12} /> Stays inside CellMate
        </span>
        {actions}
        <button className="icon" onClick={onClose} title="Close">
          <X size={18} />
        </button>
      </header>
      <div className="viewer-body" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** Renders every page to <canvas> with pdf.js: no PDF plugin, so no download / print buttons. */
export function PdfPages({ data }: { data: Uint8Array }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // pdf.js takes ownership of the buffer, so give it a copy.
    // No scripts/forms: PDF JavaScript never runs, and the page CSP forbids eval anyway.
    const task = pdfjs.getDocument({ data: data.slice(), enableXfa: false });
    (async () => {
      const doc = await task.promise;
      for (let i = 1; i <= doc.numPages && !cancelled; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.className = 'pdf-page';
        ref.current?.appendChild(canvas);
        await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
      }
    })().catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      void task.destroy();
      if (ref.current) ref.current.innerHTML = '';
    };
  }, [data]);

  return (
    <div ref={ref} className="pdf-pages">
      {error && <div className="error">Could not open PDF: {error}</div>}
    </div>
  );
}
