import { useState, type FormEvent } from 'react';
import { ArrowLeft, CircleAlert, KeyRound, LockKeyhole, QrCode } from 'lucide-react';
import { MIN_PASSWORD_LENGTH, MustChangePasswordError, parseInviteCode } from '@meetme/core';
import { client } from '../messenger';
import { Logo, errorText } from './ui';

type Mode = 'join' | 'login' | 'register';

/**
 * New people join with the QR invite from their admin (on a computer: paste the invite code) and only choose a
 * password. People who already have a password sign in. "Set up a new server" is for the admin's first account.
 */
export function Register({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('join');
  // Dev builds talk to the local server (`npm run server`) by default.
  const [server, setServer] = useState(import.meta.env.DEV ? 'http://localhost:8080' : 'https://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invite = mode === 'join' ? parseInviteCode(code) : null;
  const choosing = mode === 'join' || mustChange;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (choosing) {
      if (newPw.length < MIN_PASSWORD_LENGTH) return setError(`Password: at least ${MIN_PASSWORD_LENGTH} characters`);
      if (newPw !== newPw2) return setError('The two passwords are different');
    }
    setBusy(true);
    try {
      if (mode === 'join') await client.join(code, newPw);
      else if (mode === 'register') await client.register(server, username);
      else await client.login(server, username, password, mustChange ? newPw : undefined);
      onDone();
    } catch (err) {
      if (err instanceof MustChangePasswordError) setMustChange(true);
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m: Mode) => {
    setMode(m);
    setMustChange(false);
    setError(null);
  };

  const canSubmit =
    mode === 'join'
      ? !!invite && newPw.length > 0
      : username.length >= 3 && (mode === 'register' || (password.length > 0 && (!mustChange || newPw.length > 0)));

  return (
    <div className="register">
      <form onSubmit={submit} className="card">
        <div className="card-head">
          <Logo large />
          <h1>{mode === 'join' ? 'Join CellMate' : mode === 'login' ? 'Sign in to CellMate' : 'Set up CellMate'}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {mode === 'join'
              ? 'Your admin created your account and gave you a QR code. On a computer, paste its invite code below.'
              : mode === 'login'
                ? 'Sign in with your ID and the password you chose.'
                : 'Create the first administrator account for your server.'}
          </p>
        </div>

        {mode === 'join' ? (
          <>
            <label>
              Invite code
              <textarea
                rows={3}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="cellmate://join?…"
                autoFocus
                style={{ fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: 12 }}
              />
            </label>
            {code.trim() && !invite && (
              <div className="error">
                <CircleAlert size={16} />
                <span>That isn't a CellMate invite code. Ask your admin for the code under your QR.</span>
              </div>
            )}
            {invite && (
              <div className="notice" style={{ color: 'var(--accent-text)', background: 'var(--accent-soft)', borderColor: '#b9cbf7' }}>
                <QrCode size={16} />
                <span>
                  Joining as <strong>{invite.username}</strong> on {invite.serverUrl}. Choose your password; after this not even your admin
                  knows it.
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            <label>
              Server address
              <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://chat.yourcompany.com" />
            </label>
            <label>
              {mode === 'login' ? 'User ID' : 'Username'}
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="e.g. ravi.k"
                autoFocus
                disabled={mustChange}
              />
            </label>
            {mode === 'login' && (
              <label>
                Password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={mustChange} />
              </label>
            )}
            {mustChange && (
              <div className="notice">
                <KeyRound size={16} />
                <span>First sign-in: choose your own password. After this, not even your administrator knows it.</span>
              </div>
            )}
          </>
        )}

        {choosing && (
          <>
            <label>
              {mode === 'join' ? 'Choose a password' : 'New password'}
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </label>
            <label>
              Confirm password
              <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
            </label>
          </>
        )}

        {error && (
          <div className="error">
            <CircleAlert size={16} />
            <span>{error}</span>
          </div>
        )}
        <button className="primary block" disabled={busy || !canSubmit}>
          {busy
            ? 'Creating your encryption keys…'
            : mode === 'join'
              ? 'Set password and join'
              : mode === 'login'
                ? mustChange
                  ? 'Save password and sign in'
                  : 'Sign in'
                : 'Create administrator account'}
        </button>

        <p className="foot small" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
          {mode !== 'join' && (
            <a href="#" onClick={(e) => (e.preventDefault(), switchTo('join'))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <ArrowLeft size={14} /> I have an invite (QR) code
            </a>
          )}
          {mode !== 'login' && (
            <a href="#" onClick={(e) => (e.preventDefault(), switchTo('login'))}>
              I already have a password: sign in
            </a>
          )}
          {mode !== 'register' && (
            <a href="#" onClick={(e) => (e.preventDefault(), switchTo('register'))}>
              Administrator? Set up a new server
            </a>
          )}
        </p>
        <div className="trust">
          <LockKeyhole size={14} />
          Your encryption keys are created on this device and never leave it.
        </div>
      </form>
    </div>
  );
}
