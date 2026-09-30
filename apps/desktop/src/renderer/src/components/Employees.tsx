import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, RefreshCw, Trash2, UserPlus, Users, X } from 'lucide-react';
import { generatePassword, USERNAME_RE, type AdminUser } from '@meetme/core';
import { client } from '../messenger';
import { Avatar, errorText } from './ui';

type Share = { username: string; password: string; reset: boolean };

/** Admin panel: create employee IDs, reset passwords, remove employees. */
export function Employees({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [id, setId] = useState('');
  const [pw, setPw] = useState(generatePassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<Share | null>(null);

  const reload = useCallback(() => {
    client
      .listAllUsers()
      .then(setUsers)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(reload, [reload]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const username = id.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return setError('ID: 3-32 characters, a-z 0-9 _ .');
    setBusy(true);
    try {
      await client.createEmployee(username, pw);
      setShare({ username, password: pw, reset: false });
      setId('');
      setPw(generatePassword());
      reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset(u: string) {
    if (!confirm(`Give ${u} a new temporary password? They must choose their own password at next login.`)) return;
    const temp = generatePassword();
    try {
      await client.resetEmployeePassword(u, temp);
      setShare({ username: u, password: temp, reset: true });
      reload();
    } catch (err) {
      onToast(errorText(err));
    }
  }

  async function remove(u: string) {
    if (!confirm(`Remove ${u}? Their account is deleted and they are logged out everywhere.`)) return;
    try {
      await client.removeEmployee(u);
      onToast(`${u} removed`);
      reload();
    } catch (err) {
      onToast(errorText(err));
    }
  }

  const shareText = share
    ? `MeetMe login\nServer: ${client.account?.serverUrl}\nID: ${share.username}\nPassword: ${share.password}\n` +
      `(You will be asked to choose your own password when you log in.)`
    : '';

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Users size={18} />
            </span>
            Employees
          </div>
          <button className="icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </header>

        {share ? (
          <div className="share stack">
            <div className="ok">
              <Check size={16} />
              {share.reset ? 'New temporary password created' : 'Employee account created'}. Send these details to{' '}
              {share.username}.
            </div>
            <textarea readOnly rows={5} value={shareText} onFocus={(e) => e.currentTarget.select()} />
            <p className="muted small" style={{ margin: 0 }}>
              This password is only shown now. Send it privately (for example in person or by SMS).
            </p>
            <div className="row-end" style={{ marginTop: 4 }}>
              <button
                onClick={() =>
                  navigator.clipboard.writeText(shareText).then(
                    () => onToast('Copied to clipboard'),
                    () => onToast('Select the text and press Ctrl+C'),
                  )
                }
              >
                <Copy size={16} /> Copy
              </button>
              <button className="primary" onClick={() => setShare(null)}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={create}>
            <div className="section-title" style={{ marginTop: 4 }}>
              Add employee
            </div>
            <div className="row">
              <input
                value={id}
                onChange={(e) => setId(e.target.value.toLowerCase())}
                placeholder="Employee ID, e.g. ravi.k"
                autoFocus
              />
              <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Temporary password" />
              <button type="button" className="icon" title="Generate new password" onClick={() => setPw(generatePassword())}>
                <RefreshCw size={17} />
              </button>
              <button className="primary" disabled={busy || id.length < 3 || pw.length < 8}>
                <UserPlus size={16} /> Create
              </button>
            </div>
            {error && (
              <div className="error" style={{ marginTop: 10 }}>
                {error}
              </div>
            )}
          </form>
        )}

        <div className="section-title">All accounts ({users?.length ?? '…'})</div>
        <ul className="emp-list">
          {users?.map((u) => (
            <li key={u.username}>
              <Avatar name={u.username} size="sm" />
              <div className="grow">
                <div className="name">
                  {u.username} {u.admin && <span className="tag admin">Admin</span>}
                </div>
                <div className="state">
                  <span className={`dot ${u.active ? 'on' : ''}`} />
                  {u.active ? 'Active' : 'Not logged in yet'}
                  {u.mustChangePassword && u.active ? ' · password reset pending' : ''}
                </div>
              </div>
              {u.username !== client.account?.username && (
                <>
                  <button onClick={() => void reset(u.username)}>
                    <KeyRound size={15} /> Reset password
                  </button>
                  <button className="danger" onClick={() => void remove(u.username)}>
                    <Trash2 size={15} /> Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
