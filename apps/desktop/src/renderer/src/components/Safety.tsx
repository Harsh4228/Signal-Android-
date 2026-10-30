import { useCallback, useEffect, useState } from 'react';
import { Check, Flag, RefreshCw, X } from 'lucide-react';
import { DELETE_REQUEST, REPORT_REASONS, type Report } from '@meetme/core';
import { client } from '../messenger';
import { errorText } from './ui';

type Toast = (m: string) => void;

/** Block or unblock, after asking. Blocked people can't message or call me. */
export function toggleBlock(user: string, onToast: Toast) {
  const name = client.displayName(user);
  if (client.isBlocked(user)) {
    void client.setBlocked(user, false).then(() => onToast(`${name} unblocked`), (e) => onToast(errorText(e)));
  } else if (confirm(`Block ${name}? They won't be able to message or call you. They are not told.`)) {
    void client.setBlocked(user, true).then(() => onToast(`${name} blocked`), (e) => onToast(errorText(e)));
  }
}

/** Report someone to the admins, with the last messages of the chat so they can see what happened. */
export function ReportDialog({ user, chat, onClose, onToast }: { user: string; chat?: string; onClose: () => void; onToast: Toast }) {
  const name = client.displayName(user);
  const [reason, setReason] = useState<string>(REPORT_REASONS[0]);
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await client.report(user, reason, { details: details.trim() || undefined, chat: chat ?? user, includeMessages: true });
      if (block && !client.isBlocked(user)) await client.setBlocked(user, true);
      onToast(block ? `Reported and blocked ${name}` : `Reported ${name}. Your admin will look at it.`);
      onClose();
    } catch (e) {
      onToast(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">Report {name}</div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>
        <div className="admin-body stack">
          <label>
            Why?
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REPORT_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            More details (optional)
            <textarea rows={3} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          {!client.isBlocked(user) && (
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> Also block {name}
            </label>
          )}
          <p className="muted small">Your admin gets the last messages of this chat to look at. {name} is not told who reported them.</p>
          <button className="primary danger" disabled={busy} onClick={() => void send()}>
            <Flag size={16} /> Report
          </button>
        </div>
      </div>
    </div>
  );
}

/** Settings, when only an admin may delete accounts: ask the admins to delete mine. */
export function requestDeletion(onToast: Toast) {
  if (!confirm('Your company manages your account, so your admin deletes it. Send them a request to delete your account?')) return;
  void client.requestAccountDeletion().then(() => onToast('Request sent to your admin'), (e) => onToast(errorText(e)));
}

const when = (ts: number) => new Date(ts).toLocaleString();

/** Admin: reports from people about others, and account deletion requests. */
export function ReportsTab({ onToast }: { onToast: Toast }) {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(() => void client.getReports().then(setReports, (e) => onToast(errorText(e))), [onToast]);
  useEffect(load, [load]);
  const close = (r: Report) =>
    void client.closeReport(r.id, notes[r.id]).then(
      () => {
        onToast('Closed');
        load();
      },
      (e) => onToast(errorText(e)),
    );
  const shown = (reports ?? []).filter((r) => showClosed || r.status === 'open');
  return (
    <>
      <div className="row" style={{ marginTop: 4, marginBottom: 12 }}>
        <p className="muted small grow" style={{ margin: 0 }}>
          People report messages or behaviour here, or ask for their account to be deleted. App stores expect reports to be handled within 24 hours.
        </p>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed
        </label>
        <button className="icon" title="Refresh" onClick={load}>
          <RefreshCw size={16} />
        </button>
      </div>
      {reports === null && <p className="muted">Loading…</p>}
      {reports !== null && !shown.length && <p className="muted small">No open reports.</p>}
      <div className="stack">
        {shown.map((r) => {
          const deletion = r.reason === DELETE_REQUEST;
          return (
            <div key={r.id} className="card" style={{ padding: 14 }}>
              <div className="name">
                {deletion ? `${client.displayName(r.user)} asks to delete their account` : `${client.displayName(r.by)} reported ${client.displayName(r.user)}: ${r.reason}`}
              </div>
              <div className="muted small">
                {when(r.ts)}
                {r.status === 'closed' && ` · closed by ${r.closedBy}${r.note ? `: ${r.note}` : ''}`}
              </div>
              {!!r.details && <p style={{ margin: '6px 0' }}>{r.details}</p>}
              {deletion ? (
                <p className="muted small">Remove the account under Users, then close this request.</p>
              ) : (
                <p className="muted small">Talk to them, remove them from groups, or remove the account under Users.</p>
              )}
              {!!r.messages.length && (
                <ul className="report-messages" style={{ margin: '6px 0', paddingLeft: 18 }}>
                  {r.messages.map((m, i) => (
                    <li key={i} className={m.from === r.user ? 'danger' : undefined}>
                      <span className="muted small">
                        {client.displayName(m.from)} · {when(m.ts)}:
                      </span>{' '}
                      {m.text}
                    </li>
                  ))}
                </ul>
              )}
              {r.status === 'open' && (
                <div className="row" style={{ gap: 8, marginTop: 6 }}>
                  <input
                    className="grow"
                    placeholder="What you did (optional)"
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  />
                  <button className="primary" onClick={() => close(r)}>
                    <Check size={16} /> {deletion ? 'Done' : 'Close'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
