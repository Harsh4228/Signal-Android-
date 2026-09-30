import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH, MustChangePasswordError } from '@meetme/core';
import { client } from '../messenger';

type Mode = 'login' | 'register';

/** Employees log in with the ID + password from their admin. "Create account" is for the admin's first setup. */
export function Register({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [server, setServer] = useState('http://localhost:8080');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mustChange) {
      if (newPw.length < MIN_PASSWORD_LENGTH) return setError(`New password: at least ${MIN_PASSWORD_LENGTH} characters`);
      if (newPw !== newPw2) return setError('The two new passwords are different');
    }
    setBusy(true);
    try {
      if (mode === 'register') await client.register(server, username);
      else await client.login(server, username, password, mustChange ? newPw : undefined);
      onDone();
    } catch (err) {
      if (err instanceof MustChangePasswordError) setMustChange(true);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    username.length >= 3 && (mode === 'register' || (password.length > 0 && (!mustChange || newPw.length > 0)));

  return (
    <div className="register">
      <form onSubmit={submit} className="card">
        <div className="lock big">🔒</div>
        <h1>MeetMe</h1>
        <p className="muted">Private, end-to-end encrypted messenger</p>

        <label>
          Server
          <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://your-server" />
        </label>
        <label>
          {mode === 'login' ? 'Your ID' : 'Username'}
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="a-z, 0-9, _ ."
            autoFocus
            disabled={mustChange}
          />
        </label>

        {mode === 'login' && (
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={mustChange}
            />
          </label>
        )}

        {mustChange && (
          <>
            <div className="notice">
              First login: choose your own password. After this, not even your admin knows it.
            </div>
            <label>
              New password
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoFocus />
            </label>
            <label>
              Repeat new password
              <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
            </label>
          </>
        )}

        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy || !canSubmit}>
          {busy ? 'Creating your keys…' : mode === 'login' ? (mustChange ? 'Save password & log in' : 'Log in') : 'Create account'}
        </button>

        <p className="muted small">
          {mode === 'login' ? (
            <>
              Got your ID and password from your admin? Log in above.{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMode('register');
                  setMustChange(false);
                  setError(null);
                }}
              >
                Admin: create the first account
              </a>
            </>
          ) : (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setMode('login');
                setError(null);
              }}
            >
              ← Back to log in
            </a>
          )}
        </p>
        <p className="muted small">Your encryption keys are created on this device and never leave it.</p>
      </form>
    </div>
  );
}
