import { Lock, LockOpen, Volume2 } from 'lucide-react';
import { FONT_SIZES, MESSAGE_TONES, WALLPAPERS, type FontSize, type MessageTone } from '@meetme/core';
import { appLock, client, useClient } from '../messenger';
import { playTone, wallpaperColor } from '../appearance';

const TONE_NAMES: Record<MessageTone, string> = { default: 'Default', soft: 'Soft', bell: 'Bell', none: 'Silent' };
const SIZE_NAMES: Record<FontSize, string> = { small: 'Small', normal: 'Normal', large: 'Large', xlarge: 'Extra large' };

/** Round colour swatches; `value` undefined = "use my default". */
export function WallpaperPicker({ value, onPick, allowDefault }: { value: string | undefined; onPick: (id: string | undefined) => void; allowDefault?: boolean }) {
  return (
    <div className="wallpapers">
      {allowDefault && (
        <button type="button" className={`wp-swatch auto ${value === undefined ? 'active' : ''}`} title="Same as my default" onClick={() => onPick(undefined)}>
          Auto
        </button>
      )}
      {WALLPAPERS.map((w) => (
        <button
          type="button"
          key={w.id}
          className={`wp-swatch ${value === w.id ? 'active' : ''}`}
          title={w.name}
          style={{ background: wallpaperColor(w.id) || 'var(--surface-2)' }}
          onClick={() => onPick(w.id)}
        >
          {w.id === 'none' ? '—' : ''}
        </button>
      ))}
    </div>
  );
}

export function ToneSelect({ value, onPick, allowDefault }: { value: string | undefined; onPick: (t: MessageTone | undefined) => void; allowDefault?: boolean }) {
  return (
    <div className="row">
      <select value={value ?? ''} onChange={(e) => onPick((e.target.value || undefined) as MessageTone | undefined)}>
        {allowDefault && <option value="">Same as my default</option>}
        {MESSAGE_TONES.map((t) => (
          <option key={t} value={t}>
            {TONE_NAMES[t]}
          </option>
        ))}
      </select>
      <button type="button" className="icon" title="Play" onClick={() => playTone((value as MessageTone | undefined) ?? client.appearance.tone)}>
        <Volume2 size={16} />
      </button>
    </div>
  );
}

/** In a chat's details: its wallpaper, message tone and chat lock. */
export function ChatLookSettings({ chat, onToast }: { chat: string; onToast: (m: string) => void }) {
  const c = useClient();
  const prefs = c.chatPrefs[chat];
  const locked = c.isLocked(chat);
  return (
    <>
      <div className="section-title">Wallpaper</div>
      <WallpaperPicker value={prefs?.wallpaper} allowDefault onPick={(id) => client.setChatWallpaper(chat, id)} />
      <div className="section-title">Message tone</div>
      <ToneSelect value={prefs?.tone} allowDefault onPick={(t) => client.setChatTone(chat, t)} />
      <p className="muted small" style={{ margin: '4px 0 0' }}>
        While CellMate is open. Muting the chat silences it.
      </p>
      <div className="section-title">Chat lock</div>
      <button
        onClick={() => {
          if (!locked && !appLock.enabled) return onToast('Set up App lock in Settings first: locked chats open with its PIN');
          client.lockChat(chat, !locked);
          onToast(locked ? 'Chat unlocked' : 'Chat locked: find it under "Locked chats" at the top of your chats');
        }}
      >
        {locked ? <LockOpen size={16} /> : <Lock size={16} />} {locked ? 'Unlock this chat' : 'Lock this chat'}
      </button>
    </>
  );
}

/** Settings → Appearance: text size, default wallpaper and default message tone. */
export function AppearanceSettings() {
  const c = useClient();
  const a = c.appearance;
  return (
    <div className="stack">
      <label className="field-label">
        Text size in chats
        <select value={a.fontSize} onChange={(e) => client.setAppearance({ fontSize: e.target.value as FontSize })}>
          {(Object.keys(FONT_SIZES) as FontSize[]).map((k) => (
            <option key={k} value={k}>
              {SIZE_NAMES[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="field-label">Default chat wallpaper</div>
      <WallpaperPicker value={a.wallpaper} onPick={(id) => client.setAppearance({ wallpaper: id ?? 'none' })} />
      <div className="field-label">Default message tone</div>
      <ToneSelect value={a.tone} onPick={(t) => client.setAppearance({ tone: t ?? 'default' })} />
    </div>
  );
}
