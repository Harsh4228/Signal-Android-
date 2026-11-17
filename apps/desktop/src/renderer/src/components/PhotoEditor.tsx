import { useEffect, useRef, useState } from 'react';
import { Check, Crop, Pencil, RotateCw, Type, Undo2, X } from 'lucide-react';
import type { OutgoingFile } from '@meetme/core';

/**
 * Edit a photo before sending, like WhatsApp: rotate, crop, draw and add text. Everything happens in memory on a
 * canvas; the result is a JPEG (the original is never changed or saved).
 */
type Stroke = { kind: 'draw'; color: string; width: number; points: [number, number][] } | { kind: 'text'; color: string; size: number; x: number; y: number; text: string };
type Tool = 'draw' | 'text' | 'crop' | null;
const COLORS = ['#ffffff', '#101828', '#f04438', '#fdb022', '#12b76a', '#2e90fa', '#9e77ed'];

export function PhotoEditor({ file, onDone, onCancel }: { file: OutgoingFile; onDone: (f: OutgoingFile) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<ImageBitmap | null>(null);
  const [rotation, setRotation] = useState(0); // quarter turns
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null); // in rotated image pixels
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>(null);
  const [color, setColor] = useState(COLORS[2]!);
  const drag = useRef<{ start: [number, number]; stroke?: Stroke } | null>(null);
  const [cropDraft, setCropDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /** Text tool: where the next text goes, and what it says. */
  const [textAt, setTextAt] = useState<[number, number] | null>(null);
  const [textValue, setTextValue] = useState('');
  function addText() {
    const t = textValue.trim();
    if (t && textAt) setStrokes((s) => [...s, { kind: 'text', color, size: Math.max(24, view.w / 14), x: textAt[0], y: textAt[1], text: t.slice(0, 80) }]);
    setTextAt(null);
    setTextValue('');
  }

  useEffect(() => {
    let bmp: ImageBitmap | null = null;
    createImageBitmap(new Blob([file.data as BlobPart], { type: file.mime }), { imageOrientation: 'from-image' }).then(
      (b) => setImg((bmp = b)),
      () => onCancel(),
    );
    return () => bmp?.close();
  }, [file]);

  // The rotated image size; strokes and crop live in these coordinates.
  const W = img ? (rotation % 2 ? img.height : img.width) : 1;
  const H = img ? (rotation % 2 ? img.width : img.height) : 1;
  const view = crop ?? { x: 0, y: 0, w: W, h: H };

  /** Draw the edited picture of the area `area` onto a canvas of size w x h. */
  function paint(ctx: CanvasRenderingContext2D, area: { x: number; y: number; w: number; h: number }, w: number, h: number) {
    if (!img) return;
    const k = w / area.w;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.scale(k, k);
    ctx.translate(-area.x, -area.y);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((rotation * Math.PI) / 2);
    ctx.drawImage(img, -img.width / 2, -img.height / 2);
    ctx.restore();
    for (const s of strokes) {
      if (s.kind === 'draw') {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      } else {
        ctx.font = `600 ${s.size}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = s.size / 8;
        ctx.strokeStyle = s.color === '#101828' ? '#ffffff' : '#101828';
        ctx.strokeText(s.text, s.x, s.y);
        ctx.fillStyle = s.color;
        ctx.fillText(s.text, s.x, s.y);
      }
    }
    ctx.restore();
  }

  // Redraw the on-screen canvas (fit inside the stage).
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const maxW = Math.min(window.innerWidth - 80, 1000);
    const maxH = window.innerHeight - 220;
    const area = tool === 'crop' ? { x: 0, y: 0, w: W, h: H } : view;
    const k = Math.min(maxW / area.w, maxH / area.h, 1);
    c.width = Math.round(area.w * k);
    c.height = Math.round(area.h * k);
    const ctx = c.getContext('2d')!;
    paint(ctx, area, c.width, c.height);
    const box = cropDraft ?? (tool === 'crop' ? crop : null);
    if (box) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.rect(0, 0, c.width, c.height);
      ctx.rect(box.x * k, box.y * k, box.w * k, box.h * k);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x * k, box.y * k, box.w * k, box.h * k);
      ctx.restore();
    }
  });

  /** Mouse position in image coordinates. */
  function at(e: React.PointerEvent): [number, number] {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const area = tool === 'crop' ? { x: 0, y: 0, w: W, h: H } : view;
    return [area.x + ((e.clientX - r.left) / r.width) * area.w, area.y + ((e.clientY - r.top) / r.height) * area.h];
  }

  function down(e: React.PointerEvent) {
    const p = at(e);
    if (tool === 'text') {
      setTextAt(p);
      return;
    }
    if (!tool) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === 'draw') {
      const stroke: Stroke = { kind: 'draw', color, width: Math.max(3, view.w / 160), points: [p] };
      drag.current = { start: p, stroke };
      setStrokes((s) => [...s, stroke]);
    } else drag.current = { start: p };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    if (d.stroke?.kind === 'draw') {
      d.stroke.points.push(p);
      setStrokes((s) => [...s]);
    } else if (tool === 'crop') {
      const x = Math.max(0, Math.min(d.start[0], p[0]));
      const y = Math.max(0, Math.min(d.start[1], p[1]));
      setCropDraft({ x, y, w: Math.min(W, Math.max(d.start[0], p[0])) - x, h: Math.min(H, Math.max(d.start[1], p[1])) - y });
    }
  }
  function up() {
    drag.current = null;
    if (tool === 'crop' && cropDraft && cropDraft.w > 20 && cropDraft.h > 20) {
      setCrop(cropDraft);
      setTool(null);
    }
    setCropDraft(null);
  }

  function rotate() {
    // Strokes and crop are kept in image space; rotating clears them to keep things simple (like starting over).
    setRotation((r) => (r + 1) % 4);
    setCrop(null);
    setStrokes([]);
  }

  async function done() {
    if (!img) return;
    const area = view;
    const scale = Math.min(1, 1600 / Math.max(area.w, area.h));
    const c = document.createElement('canvas');
    c.width = Math.round(area.w * scale);
    c.height = Math.round(area.h * scale);
    paint(c.getContext('2d')!, area, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return onCancel();
    onDone({ name: `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, mime: 'image/jpeg', data: new Uint8Array(await blob.arrayBuffer()) });
  }

  return (
    <div className="editor-stage" onClick={(e) => e.stopPropagation()}>
      <header>
        <button className="icon light" title="Cancel" onClick={onCancel}>
          <X size={20} />
        </button>
        <div className="grow" />
        <button className={`icon light ${tool === 'crop' ? 'active' : ''}`} title="Crop: drag over the part to keep" onClick={() => setTool(tool === 'crop' ? null : 'crop')}>
          <Crop size={19} />
        </button>
        <button className="icon light" title="Rotate" onClick={rotate}>
          <RotateCw size={19} />
        </button>
        <button className={`icon light ${tool === 'draw' ? 'active' : ''}`} title="Draw" onClick={() => setTool(tool === 'draw' ? null : 'draw')}>
          <Pencil size={19} />
        </button>
        <button className={`icon light ${tool === 'text' ? 'active' : ''}`} title="Text: click where it goes" onClick={() => setTool(tool === 'text' ? null : 'text')}>
          <Type size={19} />
        </button>
        <button className="icon light" title="Undo" disabled={!strokes.length && !crop} onClick={() => (strokes.length ? setStrokes((s) => s.slice(0, -1)) : setCrop(null))}>
          <Undo2 size={19} />
        </button>
        <button className="primary" onClick={() => void done()}>
          <Check size={16} /> Done
        </button>
      </header>
      {(tool === 'draw' || tool === 'text') && (
        <div className="editor-colors">
          {COLORS.map((c) => (
            <button key={c} className={color === c ? 'active' : ''} style={{ background: c }} title={c} onClick={() => setColor(c)} />
          ))}
        </div>
      )}
      {textAt && (
        <form
          className="editor-text"
          onSubmit={(e) => {
            e.preventDefault();
            addText();
          }}
        >
          <input autoFocus value={textValue} maxLength={80} onChange={(e) => setTextValue(e.target.value)} placeholder="Text on the photo" />
          <button className="primary">Add</button>
          <button type="button" onClick={() => setTextAt(null)}>
            Cancel
          </button>
        </form>
      )}
      <div className="editor-canvas">
        <canvas ref={canvas} className={tool ? `tool-${tool}` : ''} onPointerDown={down} onPointerMove={move} onPointerUp={up} />
      </div>
      <div className="hint">{tool === 'crop' ? 'Drag over the part to keep' : tool === 'text' ? 'Click where the text goes' : tool === 'draw' ? 'Draw with the mouse' : ' '}</div>
    </div>
  );
}
