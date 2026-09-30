import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '@meetme/core';
import { client, useClient } from '../messenger';

export function Settings({ onClose }: { onClose: () => void }) {
  const c = useClient();
  const [busy, setBusy] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (newPw.length < MIN_PASSWORD_LENGTH) return setPwMsg({ ok: false, text: `At least ${MIN_PASSWORD_LENGTH} characters` });
    if (newPw !== newPw2) return setPwMsg({ ok: false, text: 'The two new passwords are different' });
    try {
      await client.changePassword(oldPw, newPw);
      setPwMsg({ ok: true, text: 'Password changed' });
      setOldPw('');
      setNewPw('');
      setNewPw2('');
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function logout() {
    if (!confirm('Log out on this device? Your chats here are cleared. Log in again any time with your ID and password.')) {
      return;
    }
    await client.logout();
    onClose();
  }

  async function deleteAccount() {
    if (!confirm('Delete your account and wipe all keys from this device? This cannot be undone.')) return;
    setBusy(true);
    try {
      await client.deleteAccount();
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>Settings</b>
          <button className="icon" onClick={onClose}>
            ✕
          </button>
        </header>
        <p>
          Signed in as <b>{c.account?.username}</b>
          <br />
          <span className="muted small">{c.account?.serverUrl}</span>
        </p>

        <h4>Change password</h4>
        <form onSubmit={changePassword} className="stack">
          <input type="password" placeholder="Current password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          <input type="password" placeholder="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <input
            type="password"
            placeholder="Repeat new password"
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
          />
          {pwMsg && <div className={pwMsg.ok ? 'ok' : 'error'}>{pwMsg.text}</div>}
          <button disabled={!oldPw || !newPw}>Change password</button>
        </form>

        <h4>Security on this device</h4>
        <ul className="small">
          <li>End-to-end encryption: X3DH + Double Ratchet (Signal protocol)</li>
          <li>Messages and files are kept in memory only and vanish when the app closes</li>
          <li>Keys are encrypted with your OS keychain</li>
          <li>Screenshots / screen recording of this window are blocked</li>
          <li>Downloads, copying messages and drag &amp; drop are disabled</li>
        </ul>

        <div className="row-end">
          <button onClick={() => void logout()}>Log out</button>
          <button className="danger" disabled={busy} onClick={deleteAccount}>
            Delete account
          </button>
        </div>
      </div>
    </div>
  );
}
