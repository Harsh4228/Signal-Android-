import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Fingerprint, Lock, LockOpen, ScanFace, Volume2, X } from 'lucide-react-native';
import { FONT_SIZES, MESSAGE_TONES, WALLPAPERS, type FontSize, type MessageTone } from '@meetme/core';
import { appLock, client, useClient } from '../messenger';
import { biometryLabel, verifyBiometrics } from '../biometrics';
import { PinPad } from '../PinPad';
import { colors, isDark, s } from '../theme';
import { Button, IconButton, useBack } from '../ui';
import { playTone } from '../tones';

const TONE_NAMES: Record<MessageTone, string> = { default: 'Default', soft: 'Soft', bell: 'Bell', none: 'Silent' };
const SIZE_NAMES: Record<FontSize, string> = { small: 'Small', normal: 'Normal', large: 'Large', xlarge: 'Extra large' };

/** The colour of a chat wallpaper for the current theme ('' = the normal background). */
export function wallpaperColor(id: string): string {
  const w = WALLPAPERS.find((x) => x.id === id);
  if (!w || w.id === 'none') return '';
  return isDark ? w.dark : w.light;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
      <Text style={{ color: active ? colors.accentText : colors.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function WallpaperPicker({ value, onPick, allowDefault }: { value: string | undefined; onPick: (id: string | undefined) => void; allowDefault?: boolean }) {
  return (
    <View style={[s.row, { flexWrap: 'wrap', gap: 10 }]}>
      {allowDefault && <Chip label="Auto" active={value === undefined} onPress={() => onPick(undefined)} />}
      {WALLPAPERS.map((w) => (
        <Pressable
          key={w.id}
          accessibilityLabel={`Wallpaper ${w.name}`}
          onPress={() => onPick(w.id)}
          style={[styles.swatch, { backgroundColor: wallpaperColor(w.id) || colors.bg }, value === w.id && { borderColor: colors.accent }]}
        >
          {w.id === 'none' && <Text style={s.muted}>—</Text>}
        </Pressable>
      ))}
    </View>
  );
}

export function TonePicker({ value, onPick, allowDefault }: { value: string | undefined; onPick: (t: MessageTone | undefined) => void; allowDefault?: boolean }) {
  return (
    <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
      {allowDefault && <Chip label="Default" active={value === undefined} onPress={() => onPick(undefined)} />}
      {MESSAGE_TONES.filter((t) => !allowDefault || t !== 'default').map((t) => (
        <Chip key={t} label={TONE_NAMES[t]} active={value === t} onPress={() => (onPick(t), playTone(t))} />
      ))}
      <IconButton icon={Volume2} label="Play" size={18} onPress={() => playTone((value as MessageTone | undefined) ?? client.appearance.tone)} />
    </View>
  );
}

/** In a chat's details: wallpaper, message tone and chat lock. */
export function ChatLookSettings({ chat, onToast }: { chat: string; onToast: (m: string) => void }) {
  const c = useClient();
  const prefs = c.chatPrefs[chat];
  const locked = c.isLocked(chat);
  return (
    <View style={[s.card, { marginTop: 16, padding: 14, gap: 12 }]}>
      <Text style={s.textStrong}>Wallpaper</Text>
      <WallpaperPicker value={prefs?.wallpaper} allowDefault onPick={(id) => client.setChatWallpaper(chat, id)} />
      <Text style={s.textStrong}>Message tone</Text>
      <TonePicker value={prefs?.tone} allowDefault onPick={(t) => client.setChatTone(chat, t)} />
      <Text style={[s.muted, { fontSize: 12 }]}>While CellMate is open. When it is closed, the phone's notification sound plays.</Text>
      <Button
        icon={locked ? LockOpen : Lock}
        title={locked ? 'Unlock this chat' : 'Lock this chat'}
        onPress={() => {
          if (!locked && !appLock.enabled) return onToast('Set up App lock in Settings first: locked chats open with its PIN');
          client.lockChat(chat, !locked);
          onToast(locked ? 'Chat unlocked' : 'Chat locked: find it under "Locked chats" at the top of your chats');
        }}
      />
    </View>
  );
}

/** Settings → Appearance: text size, default wallpaper, default message tone. */
export function AppearanceSettings() {
  const c = useClient();
  const a = c.appearance;
  return (
    <View style={[s.card, { padding: 14, gap: 12 }]}>
      <Text style={s.textStrong}>Text size in chats</Text>
      <View style={[s.row, { flexWrap: 'wrap', gap: 8 }]}>
        {(Object.keys(FONT_SIZES) as FontSize[]).map((k) => (
          <Chip key={k} label={SIZE_NAMES[k]} active={a.fontSize === k} onPress={() => client.setAppearance({ fontSize: k })} />
        ))}
      </View>
      <Text style={s.textStrong}>Default chat wallpaper</Text>
      <WallpaperPicker value={a.wallpaper} onPick={(id) => client.setAppearance({ wallpaper: id ?? 'none' })} />
      <Text style={s.textStrong}>Default message tone</Text>
      <TonePicker value={a.tone} onPick={(t) => client.setAppearance({ tone: t ?? 'default' })} />
    </View>
  );
}

/** Opening "Locked chats": the app lock PIN or fingerprint / Face ID. */
export function LockedChatsPrompt({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  useBack(onClose);
  const [error, setError] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const tryBio = useCallback(async () => {
    if (await verifyBiometrics()) onOpen();
  }, [onOpen]);
  useEffect(() => {
    if (!appLock.biometrics) return;
    void biometryLabel().then(setBio);
    void tryBio();
  }, [tryBio]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 }]}>
      <Pressable onPress={onClose} style={{ position: 'absolute', top: 16, left: 16, padding: 8 }} accessibilityLabel="Close">
        <X size={24} color={colors.text} />
      </Pressable>
      <PinPad
        title="Locked chats"
        subtitle="Enter your app lock PIN"
        error={error}
        busy={false}
        onComplete={(pin) =>
          void appLock.unlock(pin).then((ok) => {
            if (ok) onOpen();
            else setError(appLock.lockoutRemaining > 0 ? 'Too many wrong attempts' : 'Wrong PIN');
          })
        }
        extraKey={bio ? { icon: bio === 'Face ID' ? ScanFace : Fingerprint, label: bio, onPress: () => void tryBio() } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  swatch: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
