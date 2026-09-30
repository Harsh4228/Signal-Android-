import { useState, type FormEvent } from 'react';
import { ArrowLeft, CircleAlert, KeyRound, LockKeyhole } from 'lucide-react';
import { MIN_PASSWORD_LENGTH, MustChangePasswordError } from '@meetme/core';
import { client } from '../messenger';
import { Logo, errorText } from './ui';

type Mode = 'login' | 'register';

/** Employees log in with the ID + password from their admin. "Create account" is for the admin's first setup. */
export function Register({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [server, setServer] = useState('https://');
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
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    username.length >= 3 && (mode === 'register' || (password.length > 0 && (!mustChange || newPw.length > 0)));

  return (
    <div className="register">
      <form onSubmit={submit} className="card">
        <div className="card-head">
          <Logo large />
          <h1>{mode === 'login' ? 'Sign in to MeetMe' : 'Set up MeetMe'}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {mode === 'login'
              ? 'Use the ID and password you received from your administrator.'
              : 'Create the first administrator account for your server.'}
          </p>
        </div>

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
              <KeyRound size={16} />
              <span>First sign-in: choose your own password. After this, not even your administrator knows it.</span>
            </div>
            <label>
              New password
              <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoFocus />
            </label>
            <label>
              Confirm new password
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
            : mode === 'login'
              ? mustChange
                ? 'Save password and sign in'
                : 'Sign in'
              : 'Create administrator account'}
        </button>

        <p className="foot small">
          {mode === 'login' ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setMode('register');
                setMustChange(false);
                setError(null);
              }}
            >
              Administrator? Set up a new server
            </a>
          ) : (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setMode('login');
                setError(null);
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <ArrowLeft size={14} /> Back to sign in
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
