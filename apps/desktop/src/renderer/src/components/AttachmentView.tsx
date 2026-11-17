import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, File, FileText, Film, Forward, Image, Loader2, Lock, Play, RotateCw, Share2, Star, TriangleAlert, X } from 'lucide-react';
import { ZoomImage } from './ZoomImage';
import { formatBytes, type Attachment, type ChatMessage } from '@meetme/core';
import { client, useClient } from '../messenger';
import { ChatAvatar, errorText } from './ui';
import { SendPicker } from './SendPicker';
import { hasShareMenu, saveToDevice, sharedText, shareOut } from '../deviceFiles';

/** pdf.js (large) loads the first time a PDF is opened, not with the app: the app starts faster. */
let pdfjsLoad: Promise<typeof import('pdfjs-dist')> | null = null;
const loadPdfjs = () =>
  (pdfjsLoad ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  }));

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
  const Icon = kind === 'image' ? Image : kind === 'video' ? Film : kind === 'pdf' ? FileText : File;
  return (
    <span className={`att-icon ${kind}`}>
      <Icon size={20} />
    </span>
  );
}

/** Share to another chat, and Save to PC: each only when the admin allows it (rights of the open chat). */
export function FileActions({ a, onToast, compact }: { a: Attachment; onToast: (m: string) => void; compact?: boolean }) {
  const c = useClient();
  const [forwarding, setForwarding] = useState(false);
  const chat = c.activeChat;
  if (!a.data || (!c.can('forward', chat) && !c.can('download', chat) && !c.can('shareOut', chat))) return null;
  // Share outside CellMate works on a message: the viewer only has the file.
  const asMessage = { id: '', peer: chat ?? '', text: '', ts: 0, outgoing: false, attachment: a } as ChatMessage;

  return (
    <>
      <span className={`att-actions ${compact ? 'compact' : ''}`} onClick={(e) => e.stopPropagation()}>
        {c.can('download', chat) && (
          <button
            className="icon"
            title="Save to PC"
            onClick={() => void saveToDevice(a, chat ?? '').then((p) => p && onToast(`Saved to ${p}`), (e) => onToast(errorText(e)))}
          >
            <Download size={16} />
          </button>
        )}
        {c.canShareOut(asMessage, chat ?? '') && (
          <button
            className="icon"
            title={hasShareMenu() ? 'Share to another app' : 'Save to share in another app'}
            onClick={() => void shareOut(asMessage, chat ?? '').then((r) => r && onToast(sharedText(r)), (e) => onToast(errorText(e)))}
          >
            <Share2 size={16} />
          </button>
        )}
        {c.can('forward', chat) && (
          <button className="icon" title="Share to another chat" onClick={() => setForwarding(true)}>
            <Forward size={16} />
          </button>
        )}
      </span>
      {forwarding && <ForwardPicker a={a} onClose={() => setForwarding(false)} onToast={onToast} />}
    </>
  );
}

function ForwardPicker({ a, onClose, onToast }: { a: Attachment; onClose: () => void; onToast: (m: string) => void }) {
  async function send(picked: string[]) {
    let failed = 0;
    for (const key of picked) {
      try {
        await client.forwardAttachment(key, a, client.activeChat ?? undefined);
      } catch (e) {
        failed++;
        if (picked.length === 1) onToast(errorText(e));
      }
    }
    if (!failed) onToast(`Shared ${a.name} with ${picked.length === 1 ? client.chatTitle(picked[0]!) : `${picked.length} chats`}`);
    else if (picked.length > 1) onToast(`Shared with ${picked.length - failed}; ${failed} failed`);
    onClose();
  }
  return (
    <SendPicker
      title={`Share ${a.name}`}
      icon={<Forward size={16} />}
      files
      submit={(n) => `Share${n > 1 ? ` with ${n} chats` : ''}`}
      onSend={send}
      onClose={onClose}
    />
  );
}

/** A video in the chat: its preview with a play button, then the player (from memory; no download button). */
export function VideoPlayer({ url, poster, autoPlay, className }: { url: string; poster?: string; autoPlay?: boolean; className?: string }) {
  return (
    <video
      className={className ?? 'att-video'}
      src={url}
      poster={poster}
      controls
      autoPlay={autoPlay}
      playsInline
      preload="metadata"
      disablePictureInPicture
      controlsList="nodownload noremoteplayback"
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

const thumbUrl = (a: Attachment) => (a.thumb ? `data:image/jpeg;base64,${a.thumb}` : undefined);

export function AttachmentView({
  a,
  onToast,
  onRetry,
  onCancel,
  sticker,
}: {
  a: Attachment;
  onToast: (m: string) => void;
  onRetry?: () => void;
  /** Uploading / downloading now: stop it. */
  onCancel?: () => void;
  sticker?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const url = useObjectUrl(a);
  const preview = thumbUrl(a);
  const pct = a.progress !== undefined ? `${Math.round(a.progress * 100)}%` : null;
  const cancel = onCancel && (
    <button className="icon att-cancel" title="Cancel" onClick={(e) => (e.stopPropagation(), onCancel())}>
      <X size={16} />
    </button>
  );
  if (sticker && url && a.state === 'ready') {
    return (
      <span className="sticker-wrap">
        <img className="sticker-img" src={url} alt="Sticker" draggable={false} />
        <button
          className="icon sticker-keep"
          title="Add to my stickers"
          onClick={() => void client.addSticker({ mime: a.mime, data: a.data! }).then(() => onToast('Added to your stickers'), (e) => onToast(errorText(e)))}
        >
          <Star size={14} />
        </button>
      </span>
    );
  }

  if (a.state === 'downloading' || a.state === 'uploading') {
    // Photos / videos: the small preview (blurred) with a spinner, like WhatsApp.
    if (preview && (a.kind === 'image' || a.kind === 'video')) {
      return (
        <span className="att-image-wrap loading">
          <img className="att-image blur" src={preview} alt="" draggable={false} />
          <span className="att-overlay">
            <Loader2 size={26} className="spin" />
            <small>
              {a.state === 'uploading' ? 'Sending' : formatBytes(a.size)}
              {pct ? ` · ${pct}` : ''}
            </small>
            {cancel}
          </span>
        </span>
      );
    }
    return (
      <div className="att-card">
        <span className="att-icon">
          <Loader2 size={20} className="spin" />
        </span>
        <div className="grow">
          <div className="att-name">{a.name}</div>
          <div className="muted small">
            {a.state === 'uploading' ? 'Sending' : 'Downloading'} {formatBytes(a.size)}
            {pct ? ` · ${pct}` : '…'}
          </div>
          {a.progress !== undefined && (
            <span className="att-progress">
              <i style={{ width: pct! }} />
            </span>
          )}
        </div>
        {cancel}
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
          <div className="muted small">{a.data ? 'Not sent' : 'Could not download (it may have expired)'}</div>
        </div>
        {onRetry && (
          <button className="icon" title="Try again" onClick={onRetry}>
            <RotateCw size={16} />
          </button>
        )}
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
            <ZoomImage src={url} />
          </Viewer>
        )}
      </>
    );
  }

  if (a.kind === 'video' && url) {
    return (
      <>
        <span className="att-image-wrap">
          {open ? (
            <VideoPlayer url={url} poster={preview} autoPlay />
          ) : (
            <button className="att-video-cover" title="Play video" onClick={() => setOpen(true)}>
              {preview ? <img className="att-image" src={preview} alt="" draggable={false} /> : <span className="att-video-blank" />}
              <span className="att-play">
                <Play size={26} fill="currentColor" />
              </span>
              <small className="att-size">{formatBytes(a.size)}</small>
            </button>
          )}
          <FileActions a={a} onToast={onToast} compact />
        </span>
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.preventDefault(), onClose());
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
    let task: ReturnType<Awaited<ReturnType<typeof loadPdfjs>>['getDocument']> | null = null;
    (async () => {
      const pdfjs = await loadPdfjs();
      if (cancelled) return;
      task = pdfjs.getDocument({ data: data.slice(), enableXfa: false });
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
      void task?.destroy();
      if (ref.current) ref.current.innerHTML = '';
    };
  }, [data]);

  return (
    <div ref={ref} className="pdf-pages">
      {error && <div className="error">Could not open PDF: {error}</div>}
    </div>
  );
}
