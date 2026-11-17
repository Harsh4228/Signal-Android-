import { useEffect, useMemo, useState } from 'react';
import { Eye, File, Film, Loader2, Pencil, SendHorizontal, Smile, Trash2, X } from 'lucide-react';
import { formatBytes, type OutgoingFile } from '@meetme/core';
import { client } from '../messenger';
import { PhotoEditor } from './PhotoEditor';
import { makeSticker } from '../media';

export type Prepared = { file: OutgoingFile; caption: string };

function Preview({ f }: { f: OutgoingFile }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime })), [f]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  if (f.mime.startsWith('image/')) return <img src={url} alt="" draggable={false} />;
  if (f.mime.startsWith('video/')) return <video src={url} controls muted playsInline controlsList="nodownload" disablePictureInPicture />;
  return (
    <div className="send-file-card">
      <File size={40} />
      <div className="att-name">{f.name}</div>
      <div className="muted small">{formatBytes(f.data.length)}</div>
    </div>
  );
}

/**
 * Before sending several photos / videos / files, like WhatsApp: look at each one, give each its own caption,
 * edit photos (crop, rotate, draw, text), drop any, then send them all (each as its own message).
 */
export function SendMediaDialog({
  files,
  firstCaption,
  viewOnce,
  onSend,
  onClose,
  onToast,
}: {
  files: OutgoingFile[];
  firstCaption: string;
  viewOnce?: boolean;
  onSend: (items: Prepared[]) => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [items, setItems] = useState<Prepared[]>(() => files.map((file, i) => ({ file, caption: i === 0 ? firstCaption : '' })));
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const cur = items[Math.min(index, items.length - 1)];
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !editing && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [editing, onClose]);
  if (!cur) return null;
  const update = (patch: Partial<Prepared>) => setItems((list) => list.map((x, i) => (i === index ? { ...x, ...patch } : x)));
  const isPhoto = cur.file.mime.startsWith('image/') && !/gif/i.test(cur.file.mime);

  return (
    <div className="status-stage send-media" onClick={onClose}>
      <div className="send-media-box" onClick={(e) => e.stopPropagation()}>
        <header>
          <button className="icon light" title="Cancel (Esc)" onClick={onClose}>
            <X size={20} />
          </button>
          <span className="grow small">
            {viewOnce && (
              <>
                <Eye size={14} /> View once ·{' '}
              </>
            )}
            {cur.file.name} · {formatBytes(cur.file.data.length)}
          </span>
          {isPhoto && !viewOnce && (
            <button
              className="icon light"
              title="Keep as a sticker"
              onClick={() =>
                void makeSticker(cur.file)
                  .then((st) => client.addSticker(st))
                  .then(() => onToast('Added to your stickers'), (e) => onToast(String(e?.message ?? e)))
              }
            >
              <Smile size={19} />
            </button>
          )}
          {isPhoto && (
            <button className="icon light" title="Edit: crop, rotate, draw, text" onClick={() => setEditing(true)}>
              <Pencil size={19} />
            </button>
          )}
          {items.length > 1 && (
            <button
              className="icon light"
              title="Don't send this one"
              onClick={() => {
                setItems((list) => list.filter((_, i) => i !== index));
                setIndex((i) => Math.max(0, Math.min(i, items.length - 2)));
              }}
            >
              <Trash2 size={19} />
            </button>
          )}
        </header>
        <div className="send-media-main">
          <Preview f={cur.file} />
        </div>
        {items.length > 1 && (
          <div className="send-media-strip">
            {items.map((x, i) => (
              <button key={i} className={i === index ? 'active' : ''} onClick={() => setIndex(i)} title={x.file.name}>
                {x.file.mime.startsWith('image/') ? <Thumb f={x.file} /> : x.file.mime.startsWith('video/') ? <Film size={20} /> : <File size={20} />}
              </button>
            ))}
          </div>
        )}
        <form
          className="status-reply"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            onSend(items);
          }}
        >
          <input value={cur.caption} maxLength={4000} onChange={(e) => update({ caption: e.target.value })} placeholder="Add a caption…" autoFocus />
          <button className="primary" disabled={busy} title={`Send ${items.length}`}>
            {busy ? <Loader2 size={16} className="spin" /> : <SendHorizontal size={16} />}
            {items.length > 1 ? ` ${items.length}` : ''}
          </button>
        </form>
      </div>
      {editing && (
        <PhotoEditor
          file={cur.file}
          onCancel={() => setEditing(false)}
          onDone={(f) => {
            update({ file: { ...f, thumb: cur.file.thumb } });
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function Thumb({ f }: { f: OutgoingFile }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime })), [f]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" draggable={false} />;
}
