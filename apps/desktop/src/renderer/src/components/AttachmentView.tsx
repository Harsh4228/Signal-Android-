import { useEffect, useMemo, useRef, useState } from 'react';
import { formatBytes, type Attachment } from '@meetme/core';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** In-memory object URL (blob:) - the bytes never touch the disk. */
function useObjectUrl(a: Attachment): string | null {
  const url = useMemo(
    () => (a.data ? URL.createObjectURL(new Blob([a.data as BlobPart], { type: a.mime })) : null),
    [a.data, a.mime],
  );
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

const ICON = { image: '🖼', pdf: '📄', file: '📎' } as const;

export function AttachmentView({ a }: { a: Attachment }) {
  const [open, setOpen] = useState(false);
  const url = useObjectUrl(a);

  if (a.state === 'downloading' || a.state === 'uploading') {
    return (
      <div className="att-card">
        <span className="att-icon">{ICON[a.kind]}</span>
        <div className="grow">
          <div className="att-name">{a.name}</div>
          <div className="muted small">{a.state === 'uploading' ? 'Encrypting & sending…' : 'Decrypting…'}</div>
        </div>
      </div>
    );
  }
  if (a.state === 'failed' || !a.data) {
    return (
      <div className="att-card">
        <span className="att-icon">⚠</span>
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
        <img className="att-image" src={url} alt="" draggable={false} onClick={() => setOpen(true)} />
        {open && (
          <Viewer title={a.name} onClose={() => setOpen(false)}>
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
        title={openable ? 'Open' : 'This file type cannot be opened inside MeetMe'}
      >
        <span className="att-icon">{ICON[a.kind]}</span>
        <div className="grow">
          <div className="att-name">{a.name}</div>
          <div className="muted small">
            {formatBytes(a.size)} · {openable ? 'Click to view' : 'Preview not available'}
          </div>
        </div>
      </div>
      {open && a.kind === 'pdf' && (
        <Viewer title={a.name} onClose={() => setOpen(false)}>
          <PdfPages data={a.data} />
        </Viewer>
      )}
    </>
  );
}

function Viewer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="viewer" onClick={onClose}>
      <header onClick={(e) => e.stopPropagation()}>
        <span className="att-name">{title}</span>
        <span className="muted small">🔒 View only · not saved to this device</span>
        <button className="icon" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="viewer-body" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** Renders every page to <canvas> with pdf.js: no PDF plugin, so no download / print buttons. */
function PdfPages({ data }: { data: Uint8Array }) {
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
