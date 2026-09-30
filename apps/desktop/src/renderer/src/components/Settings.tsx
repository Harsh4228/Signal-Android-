import { useState, type FormEvent } from 'react';
import { CircleCheck, LogOut, Settings as SettingsIcon, Trash2, X } from 'lucide-react';
import { MIN_PASSWORD_LENGTH } from '@meetme/core';
import { client, useClient } from '../messenger';
import { Avatar, errorText } from './ui';

const SECURITY = [
  'End-to-end encryption with the Signal protocol (X3DH + Double Ratchet)',
  'Messages and files are kept in memory only and vanish when the app closes',
  'Encryption keys are protected by your operating system keychain',
  'Screenshots and screen recording of this window are blocked',
  'Downloads, copying messages and drag and drop are disabled',
];

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
      setPwMsg({ ok: false, text: errorText(err) });
    }
  }

  async function logout() {
    if (!confirm('Sign out on this device? Your chats here are cleared. Sign in again any time with your ID and password.')) {
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
          <div className="title">
            <span className="title-icon">
              <SettingsIcon size={18} />
            </span>
            Settings
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>

        <div className="account-card">
          <Avatar name={c.account?.username ?? '?'} />
          <div className="grow">
            <div className="name">{c.account?.username}</div>
            <div className="muted small">{c.account?.serverUrl}</div>
          </div>
        </div>

        <div className="section-title">Change password</div>
        <form onSubmit={changePassword} className="stack">
          <input type="password" placeholder="Current password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          <input type="password" placeholder="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <input
            type="password"
            placeholder="Confirm new password"
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
          />
          {pwMsg && <div className={pwMsg.ok ? 'ok' : 'error'}>{pwMsg.text}</div>}
          <div>
            <button disabled={!oldPw || !newPw}>Update password</button>
          </div>
        </form>

        <div className="section-title">Security on this device</div>
        <ul className="feature-list">
          {SECURITY.map((t) => (
            <li key={t}>
              <CircleCheck size={16} />
              {t}
            </li>
          ))}
        </ul>

        <div className="row-end" style={{ marginTop: 28 }}>
          <button onClick={() => void logout()}>
            <LogOut size={16} /> Sign out
          </button>
          <button className="danger" disabled={busy} onClick={deleteAccount}>
            <Trash2 size={16} /> Delete account
          </button>
        </div>
      </div>
    </div>
  );
}
