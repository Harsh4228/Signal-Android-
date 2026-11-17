import { useState } from 'react';
import { File, FileText, Film, HardDrive, Image, Mic, Trash2, X } from 'lucide-react';
import { formatBytes, type MediaItem } from '@meetme/core';
import { client, useClient } from '../messenger';
import { ChatAvatar, errorText } from './ui';

const ICON = { image: Image, video: Film, pdf: FileText, audio: Mic, file: File } as const;

/** Settings row: total kept on this computer, and a button for the details. */
export function StorageSettings({ onToast }: { onToast: (m: string) => void }) {
  const c = useClient();
  const [open, setOpen] = useState(false);
  const { total } = c.storageUsage();
  return (
    <>
      <div className="row-between">
        <span className="muted">{formatBytes(total)} of photos, videos and files kept encrypted on this computer</span>
        <button onClick={() => setOpen(true)}>
          <HardDrive size={16} /> Manage storage
        </button>
      </div>
      {open && <StoragePanel onClose={() => setOpen(false)} onToast={onToast} />}
    </>
  );
}

/**
 * "Manage storage", like WhatsApp: how much each chat keeps here and the biggest files. Deleting follows the admin's
 * rule for clearing history (the same as deleting one file in Media and docs).
 */
function StoragePanel({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const u = c.storageUsage();
  async function remove(m: MediaItem) {
    if (!confirm(`Delete ${m.name} (${formatBytes(m.size)}) from this computer?`)) return;
    try {
      await client.deleteMedia(m);
    } catch (e) {
      onToast(errorText(e));
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <HardDrive size={18} />
            </span>
            Storage · {formatBytes(u.total)}
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        {u.largest.length > 0 && (
          <>
            <div className="section-title">Larger than 1 MB</div>
            <ul className="doc-list">
              {u.largest.map((m) => {
                const Icon = ICON[m.kind] ?? File;
                return (
                  <li key={`${m.chat}-${m.msgId}`}>
                    <span className={`att-icon ${m.kind}`}>
                      <Icon size={20} />
                    </span>
                    <div className="grow">
                      <div className="att-name">{m.name}</div>
                      <div className="muted small">
                        {formatBytes(m.size)} · {c.chatTitle(m.chat)}
                      </div>
                    </div>
                    {c.canClearHistory && (
                      <button className="icon danger" title="Delete from this computer" onClick={() => void remove(m)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="section-title">Chats</div>
        <ul className="doc-list">
          {!u.chats.length && <li className="muted">Nothing saved yet.</li>}
          {u.chats.map((x) => (
            <li key={x.chat}>
              <ChatAvatar chatKey={x.chat} size="sm" />
              <div className="grow">
                <div className="att-name">{c.chatTitle(x.chat)}</div>
                <div className="muted small">
                  {x.count} file{x.count === 1 ? '' : 's'}
                </div>
              </div>
              <strong>{formatBytes(x.bytes)}</strong>
            </li>
          ))}
        </ul>
        {!c.canClearHistory && <p className="muted small">Your admin has turned off deleting files.</p>}
      </div>
    </div>
  );
}
