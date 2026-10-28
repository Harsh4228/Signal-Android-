import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Building2, CircleAlert, KeyRound, LockKeyhole, QrCode } from 'lucide-react';
import { MIN_PASSWORD_LENGTH, MustChangePasswordError, companyOf, makeUsername, normalizeServerUrl, parseInviteCode, shortId } from '@meetme/core';
import { client } from '../messenger';
import { Logo, PasswordInput, errorText } from './ui';

type Mode = 'join' | 'login' | 'company';

/** Remember me: the desktop app keeps it OS-encrypted; in a browser only the company and ID (never the password). */
type Remembered = { server: string; company: string; id: string; password: string };
async function loadRemembered(): Promise<Remembered | null> {
  try {
    const raw = window.meetme.remember ? await window.meetme.remember.get() : localStorage.getItem('cellmate:remember');
    const v = raw ? (JSON.parse(raw) as Partial<Remembered>) : null;
    return v && typeof v.id === 'string' ? { server: v.server ?? '', company: v.company ?? '', id: v.id, password: v.password ?? '' } : null;
  } catch {
    return null;
  }
}
async function saveRemembered(v: Remembered | null): Promise<void> {
  try {
    if (window.meetme.remember) await window.meetme.remember.set(v && JSON.stringify(v));
    else if (v) localStorage.setItem('cellmate:remember', JSON.stringify({ ...v, password: '' }));
    else localStorage.removeItem('cellmate:remember');
  } catch (e) {
    console.warn('could not save the sign-in details', e);
  }
}

/**
 * The CellMate server. People never type it: they sign in with company code, ID and password. Installed apps
 * follow the server if its domain changes. Dev builds talk to the local server (`npm run server`).
 */
const DEFAULT_SERVER = import.meta.env.DEV ? 'http://localhost:8080' : 'https://chat.gosite.lol';

/**
 * New people join with the QR invite from their admin (on a computer: paste the invite code) and only choose a
 * password. People who already have a password sign in with company code + ID + password. "Register your company"
 * asks the server owner for a new company (the very first one sets the server up).
 *
 * `moved`: this person was moved to another company; joining with the new invite keeps their chats here.
 */
export function Register({ onDone, moved }: { onDone: () => void; moved?: boolean }) {
  const [mode, setMode] = useState<Mode>(moved ? 'join' : 'login');
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [editServer, setEditServer] = useState(false);
  const [company, setCompany] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const invite = mode === 'join' ? parseInviteCode(code) : null;
  const choosing = mode === 'join' || mode === 'company' || mustChange;

  // Remember me: fill in what was saved the last time (signing out keeps it).
  useEffect(() => {
    if (moved) return;
    void loadRemembered().then((r) => {
      if (!r) return;
      if (r.server) setServer(r.server);
      setCompany(r.company);
      setUsername(r.id);
      setPassword(r.password);
    });
  }, [moved]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (choosing) {
      if (newPw.length < MIN_PASSWORD_LENGTH) return setError(`Password: at least ${MIN_PASSWORD_LENGTH} characters`);
      if (newPw !== newPw2) return setError('The two passwords are different');
    }
    setBusy(true);
    try {
      const url = normalizeServerUrl(server);
      const id = username.trim().toLowerCase();
      const co = company.trim().toLowerCase();
      if (mode === 'join') await client.join(code, newPw);
      else if (mode === 'company') await client.requestCompany(url, { companyCode: co, companyName, id, password: newPw });
      else await client.login(url, makeUsername(id, co), password, mustChange ? newPw : undefined);
      const finalPw = mode === 'login' && !mustChange ? password : newPw;
      const who = mode === 'join' && invite ? invite.username : makeUsername(id, co);
      await saveRemembered(
        remember ? { server: mode === 'join' && invite ? invite.serverUrl : url, company: companyOf(who), id: shortId(who), password: finalPw } : null,
      );
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
    setNewPw('');
    setNewPw2('');
    setError(null);
  };

  const canSubmit =
    mode === 'join'
      ? !!invite && newPw.length > 0
      : mode === 'company'
        ? company.trim().length >= 2 && !!companyName.trim() && username.length >= 3 && newPw.length > 0
        : username.length >= 3 && password.length > 0 && (!mustChange || newPw.length > 0);

  const title = moved
    ? 'Moved to a new company'
    : mode === 'join'
      ? 'Join CellMate'
      : mode === 'login'
        ? 'Sign in to CellMate'
        : 'Register your company';
  const intro = moved
    ? 'Paste the invite code from your new admin and choose a password. Your chats and files stay on this computer.'
    : mode === 'join'
      ? 'Your admin created your account and gave you a QR code. On a computer, paste its invite code below.'
      : mode === 'login'
        ? 'Sign in with your company code, your ID and your password.'
        : 'Ask for your own company. You can use it as soon as the server owner approves it.';

  return (
    <div className="register">
      <form onSubmit={submit} className="card">
        <div className="card-head">
          <Logo large />
          <h1>{title}</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {intro}
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
                  Joining as <strong>{shortId(invite.username)}</strong>. Choose your password; after this not even your admin knows it.
                </span>
              </div>
            )}
          </>
        ) : (
          <>
            {mode === 'company' && (
              <label>
                Company name
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Pvt Ltd" autoFocus />
              </label>
            )}
            <label>
              Company code
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                placeholder="e.g. acme"
                maxLength={16}
                autoFocus={mode === 'login'}
                disabled={mustChange}
              />
            </label>
            <label>
              {mode === 'login' ? 'Your ID' : 'Your ID (you will be its admin)'}
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="e.g. ravi.k"
                disabled={mustChange}
                autoComplete="username"
              />
            </label>
            {mode === 'login' && (
              <label>
                Password
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} disabled={mustChange} autoComplete="current-password" />
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
              {mode === 'login' ? 'New password' : 'Choose a password'}
              <PasswordInput value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </label>
            <label>
              Confirm password
              <PasswordInput value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
            </label>
            {mode === 'company' && (
              <p className="muted small" style={{ margin: 0 }}>
                Remember this password: you need it with your company code and ID to sign in on another device.
              </p>
            )}
          </>
        )}

        <label className="remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember me on this computer
        </label>
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
              : mode === 'company'
                ? 'Send request'
                : mustChange
                  ? 'Save password and sign in'
                  : 'Sign in'}
        </button>

        {!moved && (
          <p className="foot small" style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
            {mode !== 'join' && (
              <a href="#" onClick={(e) => (e.preventDefault(), switchTo('join'))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <QrCode size={14} /> I have an invite (QR) code
              </a>
            )}
            {mode !== 'login' && (
              <a href="#" onClick={(e) => (e.preventDefault(), switchTo('login'))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ArrowLeft size={14} /> I already have a password: sign in
              </a>
            )}
            {mode !== 'company' && (
              <a href="#" onClick={(e) => (e.preventDefault(), switchTo('company'))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Building2 size={14} /> Register your company
              </a>
            )}
          </p>
        )}
        {editServer ? (
          <label>
            Server address
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder={DEFAULT_SERVER} />
          </label>
        ) : (
          // Double-click: use a different server (testing). Normal users never see a server address.
          <div className="trust" onDoubleClick={() => setEditServer(true)}>
            <LockKeyhole size={14} />
            Your encryption keys are created on this device and never leave it.
          </div>
        )}
      </form>
    </div>
  );
}
