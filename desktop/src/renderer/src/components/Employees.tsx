import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { generatePassword, USERNAME_RE, type AdminUser } from '@meetme/core';
import { client } from '../messenger';

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
      setError(err instanceof Error ? err.message : String(err));
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
      onToast(err instanceof Error ? err.message : String(err));
    }
  }

  async function remove(u: string) {
    if (!confirm(`Remove ${u}? Their account is deleted and they are logged out everywhere.`)) return;
    try {
      await client.removeEmployee(u);
      onToast(`${u} removed`);
      reload();
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err));
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
          <b>👥 Employees</b>
          <button className="icon" onClick={onClose}>
            ✕
          </button>
        </header>

        {share ? (
          <div className="share">
            <h4>{share.reset ? 'New temporary password' : 'Employee created'} - send this to {share.username}</h4>
            <textarea readOnly rows={5} value={shareText} onFocus={(e) => e.currentTarget.select()} />
            <div className="row-end">
              <button
                onClick={() =>
                  navigator.clipboard.writeText(shareText).then(
                    () => onToast('Copied'),
                    () => onToast('Select the text and press Ctrl+C'),
                  )
                }
              >
                Copy
              </button>
              <button className="primary" onClick={() => setShare(null)}>
                Done
              </button>
            </div>
            <p className="muted small">
              This password is only shown now. Send it privately (e.g. in person or by SMS).
            </p>
          </div>
        ) : (
          <form onSubmit={create} className="add-emp">
            <h4>Add employee</h4>
            <div className="row">
              <input
                value={id}
                onChange={(e) => setId(e.target.value.toLowerCase())}
                placeholder="Employee ID, e.g. ravi.k"
                autoFocus
              />
              <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Temporary password" />
              <button type="button" title="New random password" onClick={() => setPw(generatePassword())}>
                🎲
              </button>
              <button className="primary" disabled={busy || id.length < 3 || pw.length < 8}>
                Create
              </button>
            </div>
            {error && <div className="error">{error}</div>}
          </form>
        )}

        <h4>All accounts ({users?.length ?? '…'})</h4>
        <ul className="emp-list">
          {users?.map((u) => (
            <li key={u.username}>
              <div className="avatar">{u.username[0]!.toUpperCase()}</div>
              <div className="grow">
                <div className="name">
                  {u.username} {u.admin && <span className="admin-tag">ADMIN</span>}
                </div>
                <div className="muted small">
                  {u.active ? '● Active' : '○ Not logged in yet'}
                  {u.mustChangePassword && u.active ? ' · password reset pending' : ''}
                </div>
              </div>
              {u.username !== client.account?.username && (
                <>
                  <button onClick={() => void reset(u.username)}>Reset password</button>
                  <button className="danger" onClick={() => void remove(u.username)}>
                    Remove
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
