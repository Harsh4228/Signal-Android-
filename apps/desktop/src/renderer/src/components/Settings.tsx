import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CircleCheck, LogOut, Settings as SettingsIcon, Trash2, X } from 'lucide-react';
import { MAX_EMAIL, MAX_PHONE, MIN_PASSWORD_LENGTH } from '@meetme/core';
import { appLock, client, useClient } from '../messenger';
import { AppLockSettings } from './AppLockSettings';
import { Avatar, errorText } from './ui';

const SECURITY = [
  'End-to-end encryption with the Signal protocol (X3DH + Double Ratchet)',
  'Messages are kept in memory only and vanish when the app closes; photos and documents are kept encrypted on this device',
  'Encryption keys are protected by your operating system keychain',
  'Screenshots and screen recording of this window are blocked',
  'Downloads, copying messages and drag and drop are disabled',
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

        <div className="account-card">
          {canEditProfile ? (
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
              @{c.account?.username} · {c.account?.serverUrl}
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
        {canEditProfile && (
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

        <div className="section-title">App lock</div>
        <AppLockSettings onToast={onToast} />

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
          {c.canDeleteOwnAccount && (
            <button className="danger" disabled={busy} onClick={deleteAccount}>
              <Trash2 size={16} /> Delete account
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
