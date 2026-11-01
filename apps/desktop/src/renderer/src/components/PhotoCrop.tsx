import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { ZoomIn, ZoomOut } from 'lucide-react';

/** Profile and group photos are kept this size: sharp on every screen, small enough to load fast. */
const OUT_PX = 640;
/** The crop window on screen. */
const VIEW = 300;
const MAX_ZOOM = 4;

type Pos = { x: number; y: number };

/**
 * Like WhatsApp: the person moves and zooms the picture inside a round frame, then gets that square as a
 * 640 px JPEG. Resolves null when they cancel.
 */
export function cropPhoto(file: Blob, title = 'Move and zoom'): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const finish = (fn: () => void) => {
      root.unmount();
      host.remove();
      fn();
    };
    createImageBitmap(file).then(
      (bitmap) =>
        root.render(
          <Cropper
            bitmap={bitmap}
            title={title}
            onCancel={() => finish(() => (bitmap.close(), resolve(null)))}
            onDone={(p) => finish(() => p.then(resolve, reject).finally(() => bitmap.close()))}
          />,
        ),
      () => finish(() => reject(new Error('Could not read that picture'))),
    );
  });
}

function Cropper({ bitmap, title, onCancel, onDone }: { bitmap: ImageBitmap; title: string; onCancel: () => void; onDone: (p: Promise<Uint8Array>) => void }) {
  const { width: w, height: h } = bitmap;
  // At zoom 1 the picture just covers the frame (its short side = the frame).
  const base = VIEW / Math.min(w, h);
  const [zoom, setZoom] = useState(1);
  // Where the picture's top-left corner is, relative to the frame (always <= 0: the frame stays covered).
  const [pos, setPos] = useState<Pos>({ x: (VIEW - w * base) / 2, y: (VIEW - h * base) / 2 });
  const drag = useRef<{ start: Pos; from: Pos } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = base * zoom;

  const clamp = (p: Pos, s = scale): Pos => ({
    x: Math.min(0, Math.max(VIEW - w * s, p.x)),
    y: Math.min(0, Math.max(VIEW - h * s, p.y)),
  });
  /** Zoom keeping the centre of the frame on the same spot of the picture. */
  const zoomTo = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    const s = base * next;
    const cx = (VIEW / 2 - pos.x) / scale;
    const cy = (VIEW / 2 - pos.y) / scale;
    setZoom(next);
    setPos(clamp({ x: VIEW / 2 - cx * s, y: VIEW / 2 - cy * s }, s));
  };

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, pos.x, pos.y, w * scale, h * scale);
  }, [bitmap, pos, scale, w, h]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onCancel]);

  const down = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, from: pos };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d) setPos(clamp({ x: d.from.x + e.clientX - d.start.x, y: d.from.y + e.clientY - d.start.y }));
  };

  function save() {
    onDone(
      (async () => {
        const out = document.createElement('canvas');
        // The picture's own pixels inside the frame, at most 640 (no point blowing a small picture up).
        const size = Math.min(OUT_PX, Math.max(200, Math.round(VIEW / scale)));
        out.width = out.height = size;
        const ctx = out.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        // The part of the picture inside the frame.
        ctx.drawImage(bitmap, -pos.x / scale, -pos.y / scale, VIEW / scale, VIEW / scale, 0, 0, size, size);
        const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/jpeg', 0.88));
        if (!blob) throw new Error('Could not read that picture');
        return new Uint8Array(await blob.arrayBuffer());
      })(),
    );
  }

  const dpr = window.devicePixelRatio || 1;
  return (
    <div className="modal-bg crop-bg" onClick={onCancel}>
      <div className="modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">{title}</div>
        </header>
        <div
          className="crop-view"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onWheel={(e) => zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))}
        >
          <canvas ref={canvas} width={VIEW * dpr} height={VIEW * dpr} style={{ width: VIEW, height: VIEW }} />
          <div className="crop-ring" />
        </div>
        <div className="crop-zoom">
          <button className="icon" onClick={() => zoomTo(zoom / 1.25)} title="Zoom out" disabled={zoom <= 1}>
            <ZoomOut size={17} />
          </button>
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} aria-label="Zoom" />
          <button className="icon" onClick={() => zoomTo(zoom * 1.25)} title="Zoom in" disabled={zoom >= MAX_ZOOM}>
            <ZoomIn size={17} />
          </button>
        </div>
        <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>
          Drag to move · scroll or use the slider to zoom
        </p>
        <div className="row-end" style={{ marginTop: 4 }}>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={save}>
            Use photo
          </button>
        </div>
      </div>
    </div>
  );
}
