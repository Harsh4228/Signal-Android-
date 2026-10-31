import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CircleCheck, CloudUpload, LogOut, Settings as SettingsIcon, Trash2, X } from 'lucide-react';
import { birthdayText, MAX_ABOUT, MAX_EMAIL, MAX_PHONE, MIN_PASSWORD_LENGTH, shortId } from '@meetme/core';
import { appLock, client, useClient } from '../messenger';
import { AppLockSettings } from './AppLockSettings';
import { getTheme, setTheme, type ThemeChoice } from '../theme';
import { enableWebPush, needsHomeScreen, webPushState, webPushSupported } from '../webPush';
import { Avatar, PasswordInput, errorText } from './ui';
import { ProfileHero } from './Profile';
import { requestDeletion, toggleBlock } from './Safety';

const SECURITY = [
  'End-to-end encryption with the Signal protocol (X3DH + Double Ratchet)',
  'Chats, photos and documents are kept encrypted on this device; the chat backup on the server is locked with your password',
  'Encryption keys are protected by your operating system keychain',
  'Screenshots and screen recording of this window are blocked unless your admin allows them',
  'Saving files and copying messages work only if your admin allows them; drag and drop is disabled',
];

/** Shrink a picked photo to a square-ish JPEG (max 400 px) so it loads fast everywhere. */
async function shrinkPhoto(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('Could not read that picture');
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * My mobile number and email; colleagues see them under my name. On a company server the admin set them and
 * only the admin can change them (shown read-only); admins edit their own here.
 */
function ContactSettings({ onToast, editable }: { onToast: (m: string) => void; editable: boolean }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    client
      .getMyContactInfo()
      .then((c) => {
        setName(c.name);
        setPhone(c.phone);
        setEmail(c.email);
      })
      .catch(() => setPhone(''));
  }, []);

  if (!editable) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        <div className="readonly-field">
          <span className="muted small">Name</span>
          {name || '—'}
        </div>
        <div className="readonly-field">
          <span className="muted small">Mobile</span>
          {phone || '—'}
        </div>
        <div className="readonly-field">
          <span className="muted small">Email</span>
          {email || '—'}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Your name, photo, mobile and email are set by your admin. Ask your admin if something needs to change.
        </p>
      </div>
    );
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await client.setMyContactInfo(phone ?? '', email);
      onToast('Saved');
    } catch (err) {
      onToast(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (phone === null) return <p className="muted small">Loading…</p>;
  return (
    <form onSubmit={save} className="stack">
      <input value={phone} maxLength={MAX_PHONE} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number, e.g. +91 98765 43210" type="tel" />
      <input value={email} maxLength={MAX_EMAIL} onChange={(e) => setEmail(e.target.value)} placeholder="Work email" type="email" />
      <p className="muted small" style={{ margin: 0 }}>
        Shown to your colleagues under your name, with your department.
      </p>
      <div>
        <button disabled={busy}>Save</button>
      </div>
    </form>
  );
}

export function Settings({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }) {
  const c = useClient();
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const hasPhoto = !!c.account && !!c.avatarOf(c.account.username);
  // Profiles are set by the admin; only admins (or anyone on a server without admins) edit their own.
  const canEditProfile = c.isAdmin || c.admins.length === 0;
  // The profile photo: also with the admin's "Change own profile photo" permission.
  const canEditPhoto = canEditProfile || c.can('profilePhoto');

  async function changePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      await client.setMyAvatar({ mime: 'image/jpeg', data: await shrinkPhoto(file) });
      onToast('Profile photo updated');
    } catch (err) {
      onToast(errorText(err));
    } finally {
      setPhotoBusy(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      await client.removeMyAvatar();
      onToast('Profile photo removed');
    } catch (err) {
      onToast(errorText(err));
    } finally {
      setPhotoBusy(false);
    }
  }
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
    await appLock.load();
    onClose();
  }

  async function deleteAccount() {
    if (!confirm('Delete your account and wipe all keys from this device? This cannot be undone.')) return;
    setBusy(true);
    try {
      await client.deleteAccount();
      await appLock.load();
      onClose();
    } catch (err) {
      onToast(errorText(err));
    } finally {
      setBusy(false);
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

        {c.account && c.avatarOf(c.account.username) && <ProfileHero user={c.account.username} />}
        <div className="account-card">
          {canEditPhoto ? (
            <button
              className="avatar-edit"
              title="Change profile photo"
              disabled={photoBusy}
              onClick={() => photoInput.current?.click()}
            >
              <Avatar name={c.account?.username ?? '?'} />
              <span className="avatar-edit-badge">
                <Camera size={12} />
              </span>
            </button>
          ) : (
            <Avatar name={c.account?.username ?? '?'} />
          )}
          <div className="grow">
            <div className="name">{c.account ? c.displayName(c.account.username) : ''}</div>
            <div className="muted small">
              @{c.account ? shortId(c.account.username) : ''}
              {c.company ? ` · ${c.company.name} (${c.company.code})` : ` · ${c.account?.serverUrl ?? ''}`}
            </div>
          </div>
          <input
            ref={photoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => void changePhoto(e.target.files?.[0])}
          />
        </div>
        {canEditPhoto && (
          <>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button disabled={photoBusy} onClick={() => photoInput.current?.click()}>
                <Camera size={16} /> {photoBusy ? 'Saving…' : hasPhoto ? 'Change photo' : 'Add profile photo'}
              </button>
              {hasPhoto && (
                <button disabled={photoBusy} onClick={() => void removePhoto()}>
                  <Trash2 size={16} /> Remove photo
                </button>
              )}
            </div>
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              Everyone at your company can see your profile photo. Unlike messages, it is not end-to-end encrypted.
            </p>
          </>
        )}

        <div className="section-title">{canEditProfile ? 'Mobile number & email' : 'My profile'}</div>
        <ContactSettings onToast={onToast} editable={canEditProfile} />
        <BirthdaySetting onToast={onToast} />

        {(webPushSupported() || needsHomeScreen()) && (
          <>
            <div className="section-title">Notifications</div>
            <WebNotifications />
          </>
        )}

        <div className="section-title">Appearance</div>
        <ThemePicker />

        <div className="section-title">Privacy</div>
        <PrivacySettings />

        <div className="section-title">App lock</div>
        <AppLockSettings onToast={onToast} />

        {c.isSuper && (
          <>
            <div className="section-title">Server owner</div>
            <div className="stack">
              <p className="muted small" style={{ margin: 0 }}>
                Approve companies, add new ones and move people between them. Opens in your browser; sign in there with company code,
                ID and password.
              </p>
              <button onClick={() => c.account && void window.meetme.openSuper?.(c.account.serverUrl)}>Open the companies page</button>
            </div>
          </>
        )}

        <div className="section-title">Chat backup</div>
        <BackupSettings />

        <div className="section-title">Change password</div>
        <form onSubmit={changePassword} className="stack">
          <PasswordInput placeholder="Current password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          <PasswordInput placeholder="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <PasswordInput
            
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

        <div className="section-title">Blocked</div>
        {c.blocked.length ? (
          <ul className="member-list">
            {c.blocked.map((u) => (
              <li key={u}>
                <Avatar name={u} size="sm" />
                <div className="grow name">{c.displayName(u)}</div>
                <button onClick={() => toggleBlock(u, () => {})}>Unblock</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nobody is blocked. To block someone, open their chat details and choose Block.</p>
        )}

        <div className="row-end" style={{ marginTop: 28 }}>
          <button onClick={() => void logout()}>
            <LogOut size={16} /> Sign out
          </button>
          {c.canDeleteOwnAccount ? (
            <button className="danger" disabled={busy} onClick={deleteAccount}>
              <Trash2 size={16} /> Delete account
            </button>
          ) : (
            <button className="danger" onClick={() => requestDeletion((m) => alert(m))}>
              <Trash2 size={16} /> Ask admin to delete my account
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The end-to-end encrypted chat backup: when it last ran, "Back up now", and an older locked backup. */
function BackupSettings() {
  const c = useClient();
  const [old, setOld] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Your chats are backed up to the server, encrypted with your password: when you sign in on another phone or computer they
        come back. Nobody else, not even the admin or the server, can read them. Last backup:{' '}
        {c.lastBackupAt ? new Date(c.lastBackupAt).toLocaleString() : 'not yet'}.
      </p>
      {c.backupLocked ? (
        <>
          <div className="notice">
            You have older chats in a backup made with your previous password. Enter that password to bring them back.
          </div>
          <PasswordInput value={old} onChange={(e) => setOld(e.target.value)} placeholder="Previous password" />
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" disabled={busy || !old} onClick={() => void run(async () => `Restored ${await client.restoreOldBackup(old)} messages`)}>
              Restore older chats
            </button>
            <button
              disabled={busy}
              onClick={() =>
                confirm('Start a new backup? The older chats will be gone for good.') &&
                void run(async () => (await client.discardOldBackup(), 'New backup started'))
              }
            >
              Start a new backup
            </button>
          </div>
        </>
      ) : (
        <button disabled={busy} onClick={() => void run(async () => (await client.flushHistory(), 'Backed up'))}>
          <CloudUpload size={16} /> Back up now
        </button>
      )}
      {msg && <div className={msg.ok ? 'notice' : 'error'}>{msg.text}</div>}
    </div>
  );
}
/** My birth date: colleagues see it on my profile. */
function BirthdaySetting({ onToast }: { onToast: (m: string) => void }) {
  const c = useClient();
  const [value, setValue] = useState(c.birthday);
  useEffect(() => setValue(c.birthday), [c.birthday]);
  return (
    <label className="field-label" style={{ marginTop: 10 }}>
      Birth date
      <span className="row" style={{ gap: 6 }}>
        <input
          className="grow"
          type="date"
          value={value}
          min="1900-01-01"
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setValue(e.target.value)}
        />
        {value !== c.birthday && (
          <button onClick={() => void client.setPrivacy({ birthday: value }).then(() => onToast(value ? 'Birth date saved' : 'Birth date removed'), (e) => onToast(errorText(e)))}>
            Save
          </button>
        )}
      </span>
      {c.birthday && <span className="muted small">{birthdayText(c.birthday)} · colleagues see it on your profile</span>}
    </label>
  );
}

/** Like WhatsApp: my About line, read receipts and last seen. */
function PrivacySettings() {
  const c = useClient();
  const [about, setAbout] = useState(c.about);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setAbout(c.about), [c.about]);
  const save = (fn: () => Promise<void>, done: string) =>
    void fn().then(
      () => setMsg(done),
      (e) => setMsg(errorText(e)),
    );
  return (
    <div className="stack">
      <label className="field-label">
        About
        <span className="row" style={{ gap: 6 }}>
          <input className="grow" value={about} onChange={(e) => setAbout(e.target.value)} placeholder="e.g. At the Pune office" maxLength={MAX_ABOUT} />
          {about.trim() !== c.about && <button onClick={() => save(() => client.setPrivacy({ about }), 'About saved')}>Save</button>}
        </span>
      </label>
      <label className="setting">
        <div className="grow">
          <div className="name">Read receipts</div>
          <div className="muted small">When off, people don't see when you read their messages, and you don't see theirs.</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={c.privacy.readReceipts}
          onChange={(e) => save(() => client.setReadReceipts(e.target.checked), e.target.checked ? 'Read receipts on' : 'Read receipts off')}
        />
      </label>
      <label className="setting">
        <div className="grow">
          <div className="name">Hide last seen & online</div>
          <div className="muted small">Nobody sees when you were last online, and you don't see theirs.</div>
        </div>
        <input
          type="checkbox"
          className="switch"
          checked={c.hideLastSeen}
          onChange={(e) => save(() => client.setPrivacy({ hideLastSeen: e.target.checked }), e.target.checked ? 'Last seen hidden' : 'Last seen shown')}
        />
      </label>
      {msg && <p className="muted small" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
/** Web app only: turn on message and call notifications (iPhone: from the home-screen app). */
function WebNotifications() {
  const [state, setState] = useState(webPushState());
  const [msg, setMsg] = useState<string | null>(null);
  if (needsHomeScreen()) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        To get notifications on iPhone, add CellMate to your home screen first: tap Share, then Add to Home Screen, and open it from
        there.
      </p>
    );
  }
  const on = async () => {
    try {
      const ok = await enableWebPush(true);
      setState(webPushState());
      setMsg(ok ? 'Notifications are on' : 'Notifications are blocked: allow them for this site in the browser settings');
    } catch (e) {
      setMsg(errorText(e));
    }
  };
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Get told about new messages and calls when CellMate is closed. The notification never shows who wrote or what.
      </p>
      {state === 'granted' ? <div className="notice">Notifications are on</div> : <button onClick={() => void on()}>Turn on notifications</button>}
      {msg && state !== 'granted' && <p className="muted small" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
/** Light, dark, or like the computer. */
function ThemePicker() {
  const [choice, setChoice] = useState<ThemeChoice>(getTheme());
  const pick = (c: ThemeChoice) => {
    setTheme(c);
    setChoice(c);
  };
  return (
    <div className="seg">
      {(
        [
          ['system', 'System'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ] as [ThemeChoice, string][]
      ).map(([c, label]) => (
        <button key={c} type="button" className={choice === c ? 'active' : ''} onClick={() => pick(c)}>
          {label}
        </button>
      ))}
    </div>
  );
}