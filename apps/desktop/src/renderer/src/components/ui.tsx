import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff, ShieldCheck, UsersRound } from 'lucide-react';
import { isGroupKey } from '@meetme/core';
import { client } from '../messenger';

/** Soft background / strong text pairs, picked per name so each contact keeps the same colour. */
const PALETTE: [string, string][] = [
  ['#eaf0fd', '#1a3f9e'],
  ['#ecfdf3', '#067647'],
  ['#fef6ee', '#b93815'],
  ['#f4f3ff', '#5925dc'],
  ['#fdf2fa', '#c11574'],
  ['#f0f9ff', '#026aa2'],
  ['#fefbe8', '#a15c07'],
  ['#f2f4f7', '#344054'],
];

function colorFor(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** The person's profile photo if they set one, otherwise their initial on a colour of their own. */
export function Avatar({ name, size }: { name: string; size?: 'sm' | 'xl' }) {
  const [bg, fg] = colorFor(name);
  const photo = client.avatarOf(name);
  if (photo) return <img className={`avatar photo ${size ?? ''}`} src={photo} alt="" draggable={false} />;
  return (
    <div className={`avatar ${size ?? ''}`} style={{ background: bg, color: fg }}>
      {client.displayName(name).slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Avatar for a chat: a group icon, or the person with a green dot while they are online. */
export function ChatAvatar({ chatKey, size }: { chatKey: string; size?: 'sm' | 'xl' }) {
  if (isGroupKey(chatKey)) {
    return (
      <div className={`avatar group-avatar ${size ?? ''}`}>
        <UsersRound size={size === 'sm' ? 16 : 20} />
      </div>
    );
  }
  // A green ring while they have a status I haven't viewed (grey once viewed), like WhatsApp.
  const ring = client.statusRingOf(chatKey);
  return (
    <div className={`avatar-wrap${ring ? ` ring ${ring}` : ''}`}>
      <Avatar name={chatKey} size={size} />
      {client.getPresence(chatKey)?.online && <span className="presence-dot" />}
    </div>
  );
}

/** "alice is typing…", "alice and bob are typing…" */
export function typingText(names: string[], group: boolean): string {
  if (!names.length) return '';
  if (!group) return 'typing…';
  return names.length === 1 ? `${names[0]} is typing…` : `${names.slice(0, 2).join(' and ')} are typing…`;
}

export function Logo({ large }: { large?: boolean }) {
  return (
    <div className={`logo ${large ? 'lg' : ''}`}>
      <ShieldCheck size={large ? 28 : 18} strokeWidth={2} />
    </div>
  );
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** "14:05" today, "Mon" this week, otherwise "12/03/26". */
export function shortTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (now.getTime() - ts < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** A password box with an eye button to show / hide what was typed. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password-field">
      <input {...props} type={shown ? 'text' : 'password'} />
      <button type="button" className="icon" tabIndex={-1} title={shown ? 'Hide password' : 'Show password'} onClick={() => setShown((v) => !v)}>
        {shown ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </span>
  );
}