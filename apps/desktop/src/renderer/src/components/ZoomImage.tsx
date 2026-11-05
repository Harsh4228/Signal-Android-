import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';

const MAX = 5;

/**
 * A photo in the viewer that can be zoomed: mouse wheel / trackpad pinch (towards the pointer), double-click,
 * the + and - buttons; drag to move around when zoomed. Touch screens (web app on a phone) pinch with two fingers.
 */
export function ZoomImage({ src }: { src: string }) {
  const [z, setZ] = useState({ scale: 1, x: 0, y: 0 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);

  /** Zoom to `scale` (or by a factor of the current one), keeping the point (px, py) - from the box centre - in place. */
  const zoomAt = (scale: number | ((current: number) => number), px = 0, py = 0) =>
    setZ((o) => {
      const s = Math.min(MAX, Math.max(1, typeof scale === 'function' ? scale(o.scale) : scale));
      if (s === 1) return { scale: 1, x: 0, y: 0 };
      const k = s / o.scale;
      return { scale: s, x: px - (px - o.x) * k, y: py - (py - o.y) * k };
    });
  const centred = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return [clientX - r.left - r.width / 2, clientY - r.top - r.height / 2] as const;
  };

  // The wheel zooms instead of scrolling: a native listener, because React's wheel events can't stop the scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt((s) => s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  function down(e: ReactPointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: z.scale };
      drag.current = null;
    } else if (z.scale > 1) drag.current = { x: e.clientX, y: e.clientY, from: { x: z.x, y: z.y } };
  }
  function move(e: ReactPointerEvent) {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && touches.current.size === 2) {
      const [a, b] = [...touches.current.values()];
      const [px, py] = centred((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      zoomAt(pinch.current.scale * (Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.current.dist), px, py);
    } else if (drag.current) {
      const d = drag.current;
      setZ((o) => ({ ...o, x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y }));
    }
  }
  function up(e: ReactPointerEvent) {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    drag.current = null;
  }

  return (
    <div
      ref={box}
      className={`zoom-box${z.scale > 1 ? ' zoomed' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(e) => {
        const [px, py] = centred(e.clientX, e.clientY);
        zoomAt(z.scale > 1 ? 1 : 2.5, px, py);
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <img className="viewer-image zoom-image" src={src} alt="" draggable={false} style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.scale})` }} />
      <div className="zoom-controls" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button className="icon" title="Zoom out" disabled={z.scale <= 1} onClick={() => zoomAt(z.scale / 1.5)}>
          <Minus size={16} />
        </button>
        <span className="zoom-level">{Math.round(z.scale * 100)}%</span>
        <button className="icon" title="Zoom in" disabled={z.scale >= MAX} onClick={() => zoomAt(z.scale * 1.5)}>
          <Plus size={16} />
        </button>
        <button className="icon" title="Fit to screen" disabled={z.scale === 1} onClick={() => zoomAt(1)}>
          <RotateCcw size={15} />
        </button>
      </div>
    </div>
  );
}
