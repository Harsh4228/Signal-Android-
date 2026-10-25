import { useEffect, useState } from 'react';
import { ChevronRight, File, FileText, Image, Loader2, Trash2, TriangleAlert, X } from 'lucide-react';
import { formatBytes, type Attachment, type MediaItem } from '@meetme/core';
import { client, useClient } from '../messenger';
import { FileActions, PdfPages, Viewer, useObjectUrl } from './AttachmentView';
import { AudioView } from './ChatExtras';
import { errorText } from './ui';

const isMedia = (m: MediaItem) => m.kind === 'image';
const day = (ts: number) => new Date(ts).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
const month = (ts: number) => new Date(ts).toLocaleDateString([], { month: 'long', year: 'numeric' });

/** Decrypt a saved file into memory while it is shown; the bytes are wiped again afterwards. */
function useSaved(item: MediaItem | null): { a: Attachment | null; error: string | null } {
  const [a, setA] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!item) return;
    let gone = false;
    let loaded: Attachment | null = null;
    setA(null);
    setError(null);
    client
      .openMedia(item)
      .then((x) => {
        loaded = x;
        if (!gone) setA(x);
      })
      .catch((e) => !gone && setError(errorText(e)));
    return () => {
      gone = true;
      loaded?.data?.fill(0);
    };
  }, [item]);
  return { a, error };
}

/** "Media and docs" block in the chat details panel: a few thumbnails, and a link to all of them. */
export function MediaSection({ chatKey, onToast }: { chatKey: string; onToast: (m: string) => void }) {
  const c = useClient();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const items = c.getMedia(chatKey);
  const photos = items.filter(isMedia).slice(0, 6);

  return (
    <>
      <button className="media-head" onClick={() => setOpen(true)}>
        <span className="grow">Media and docs</span>
        <span className="muted">{items.length}</span>
        <ChevronRight size={16} />
      </button>
      {items.length === 0 ? (
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Photos and documents from this chat appear here. They are kept encrypted on this device.
        </p>
      ) : (
        photos.length > 0 && (
          <div className="media-strip">
            {photos.map((m) => (
              <Thumb key={m.msgId} item={m} onOpen={() => setViewing(m)} />
            ))}
          </div>
        )
      )}
      {open && <MediaGallery chatKey={chatKey} onClose={() => setOpen(false)} onToast={onToast} />}
      {viewing && <SavedViewer item={viewing} onClose={() => setViewing(null)} onToast={onToast} />}
    </>
  );
}

/** Every saved photo and document of a chat, like WhatsApp's "Media, links and docs". */
function MediaGallery({ chatKey, onClose, onToast }: { chatKey: string; onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [tab, setTab] = useState<'media' | 'docs'>('media');
  const [viewing, setViewing] = useState<MediaItem | null>(null);
  const items = c.getMedia(chatKey);
  const shown = items.filter((m) => (tab === 'media') === isMedia(m));

  // Grouped by month, newest first.
  const groups: [string, MediaItem[]][] = [];
  for (const m of shown) {
    const label = month(m.ts);
    const last = groups[groups.length - 1];
    if (last?.[0] === label) last[1].push(m);
    else groups.push([label, [m]]);
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide media-gallery" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Image size={18} />
            </span>
            {c.chatTitle(chatKey)} · Media and docs
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="tabs">
          <button className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>
            Media ({items.filter(isMedia).length})
          </button>
          <button className={tab === 'docs' ? 'active' : ''} onClick={() => setTab('docs')}>
            Docs ({items.filter((m) => !isMedia(m)).length})
          </button>
        </div>
        {!shown.length && (
          <div className="notice-empty muted">
            {tab === 'media' ? <Image size={28} color="var(--faint)" /> : <FileText size={28} color="var(--faint)" />}
            <div>{tab === 'media' ? 'No photos yet' : 'No documents yet'}</div>
          </div>
        )}
        {groups.map(([label, list]) => (
          <div key={label}>
            <div className="section-title">{label}</div>
            {tab === 'media' ? (
              <div className="media-grid">
                {list.map((m) => (
                  <Thumb key={m.msgId} item={m} onOpen={() => setViewing(m)} />
                ))}
              </div>
            ) : (
              <ul className="doc-list">
                {list.map((m) => (
                  <li key={m.msgId} className="clickable" onClick={() => setViewing(m)}>
                    <span className={`att-icon ${m.kind}`}>{m.kind === 'pdf' ? <FileText size={20} /> : <File size={20} />}</span>
                    <div className="grow">
                      <div className="att-name">{m.name}</div>
                      <div className="muted small">
                        {formatBytes(m.size)} · {m.outgoing ? 'You' : client.displayName(m.from)} · {day(m.ts)}
                      </div>
                      {m.caption && <div className="small doc-caption">{m.caption}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <p className="muted small" style={{ marginBottom: 0 }}>
          Kept encrypted on this device. Messages themselves are not saved, only the files.
        </p>
      </div>
      {viewing && <SavedViewer item={viewing} onClose={() => setViewing(null)} onToast={onToast} />}
    </div>
  );
}

function Thumb({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const { a, error } = useSaved(item);
  const url = useObjectUrl(a ?? { name: '', mime: item.mime, size: 0, kind: 'image', state: 'downloading' });
  return (
    <button className="media-thumb" onClick={onOpen} title={`${item.name} · ${day(item.ts)}`}>
      {url ? <img src={url} alt="" draggable={false} /> : error ? <TriangleAlert size={18} /> : <Loader2 size={18} className="spin" />}
    </button>
  );
}

/** Full-screen view of a saved file, with Share to a chat, and Delete (if the admin allows clearing history). */
function SavedViewer({ item, onClose, onToast }: { item: MediaItem; onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const { a, error } = useSaved(item);
  const url = useObjectUrl(a ?? { name: '', mime: item.mime, size: 0, kind: item.kind, state: 'downloading' });

  async function remove() {
    if (!confirm(`Delete ${item.name} from this device?`)) return;
    try {
      await client.deleteMedia(item);
      onClose();
    } catch (e) {
      onToast(errorText(e));
    }
  }

  const actions = (
    <>
      {a && <FileActions a={a} onToast={onToast} />}
      {c.canClearHistory && (
        <button className="icon danger" title="Delete from this device" onClick={() => void remove()}>
          <Trash2 size={16} />
        </button>
      )}
    </>
  );

  return (
    <Viewer title={`${item.name} · ${item.outgoing ? 'You' : client.displayName(item.from)} · ${day(item.ts)}`} onClose={onClose} actions={actions}>
      {error ? (
        <div className="error">{error}</div>
      ) : !a?.data ? (
        <Loader2 size={24} className="spin" color="#fff" />
      ) : item.kind === 'image' && url ? (
        <img className="viewer-image" src={url} alt="" draggable={false} />
      ) : item.kind === 'pdf' ? (
        <PdfPages data={a.data} />
      ) : item.kind === 'audio' ? (
        <div className="att-card">
          <AudioView a={a} />
        </div>
      ) : (
        <div className="att-card">
          <span className="att-icon">
            <File size={20} />
          </span>
          <div className="grow">
            <div className="att-name">{item.name}</div>
            <div className="muted small">{formatBytes(item.size)} · Preview not available</div>
          </div>
        </div>
      )}
    </Viewer>
  );
}
