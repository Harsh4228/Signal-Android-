import { ShieldCheck } from 'lucide-react';

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

export function Avatar({ name, size }: { name: string; size?: 'sm' | 'xl' }) {
  const [bg, fg] = colorFor(name);
  return (
    <div className={`avatar ${size ?? ''}`} style={{ background: bg, color: fg }}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
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
