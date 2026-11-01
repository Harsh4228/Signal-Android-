import { useState } from 'react';
import { Eraser, X } from 'lucide-react';
import { CLEAR_AGES, CLEAR_KINDS, type ClearKind } from '@meetme/core';
import { client } from '../messenger';
import { errorText } from './ui';

/**
 * Admin: clear chat history of a person (all their chats) or of a group (on every member's device), by age and kind.
 * Messages are end-to-end encrypted and only on the devices, so each app removes them when it is next online.
 */
export function ClearHistoryModal({
  scope,
  target,
  label,
  onClose,
  onToast,
}: {
  scope: 'user' | 'group';
  /** Username or group id. */
  target: string;
  /** The person's or group's name, for the title. */
  label: string;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [days, setDays] = useState(30);
  const [kinds, setKinds] = useState<Set<ClearKind>>(new Set(CLEAR_KINDS.map(([k]) => k)));
  const [busy, setBusy] = useState(false);
  const all = kinds.size === CLEAR_KINDS.length;
  const toggle = (k: ClearKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setKinds(next);
  };
  const ageText = CLEAR_AGES.find(([d]) => d === days)?.[1].toLowerCase() ?? '';
  const what = all ? 'all messages, files and calls' : CLEAR_KINDS.filter(([k]) => kinds.has(k)).map(([, l]) => l.split(' (')[0]!.toLowerCase()).join(', ');
  const where = scope === 'user' ? `in all of ${label}'s chats, on their devices` : `in the group "${label}", on every member's device`;

  async function clear() {
    if (!confirm(`Clear ${what} (${ageText}) ${where}?\n\nThis can't be undone.`)) return;
    setBusy(true);
    try {
      await client.adminClearHistory({ scope, target, olderThanDays: days, kinds: [...kinds] });
      onToast(scope === 'user' ? `Clearing ${label}'s history: done on their devices when they are online` : `Clearing "${label}": done on each member's device when they are online`);
      onClose();
    } catch (e) {
      onToast(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal clear-modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Eraser size={18} />
            </span>
            Clear history · {label}
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body stack" style={{ gap: 14 }}>
          <p className="muted small" style={{ margin: 0 }}>
            {scope === 'user'
              ? `Clears ${label}'s chats (1-to-1 and the groups they are in) on their own devices. Others keep their copies.`
              : 'Clears this group chat on the devices of everyone in it.'}{' '}
            Messages are end-to-end encrypted, so each app removes them the next time it is online.
          </p>

          <div>
            <div className="section-title" style={{ marginTop: 0 }}>
              Which messages
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {CLEAR_AGES.map(([d, l]) => (
                <button key={d} type="button" className={`chip-select${days === d ? ' active' : ''}`} onClick={() => setDays(d)}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="section-title" style={{ marginTop: 0 }}>
              What to clear
            </div>
            <label className="check-row">
              <input type="checkbox" checked={all} onChange={() => setKinds(all ? new Set() : new Set(CLEAR_KINDS.map(([k]) => k)))} />
              <strong>Everything</strong>
            </label>
            {CLEAR_KINDS.map(([k, l]) => (
              <label key={k} className="check-row">
                <input type="checkbox" checked={kinds.has(k)} onChange={() => toggle(k)} />
                {l}
              </label>
            ))}
          </div>

          <div className="row-end" style={{ marginTop: 0 }}>
            <button onClick={onClose}>Cancel</button>
            <button className="primary danger" disabled={busy || !kinds.size} onClick={() => void clear()}>
              <Eraser size={15} /> Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
