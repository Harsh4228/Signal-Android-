import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { ArrowUpDown, Check, ChevronLeft, Eye, EyeOff, ShieldCheck, UsersRound, type LucideIcon } from 'lucide-react-native';
import { isGroupKey, richPieces } from '@meetme/core';
import { client } from './messenger';
import { colors, isDark, s } from './theme';

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

export function colorFor(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** The person's profile photo if they set one, otherwise their initial on a colour of their own. */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const [bg, fg] = colorFor(name);
  const photo = client.avatarOf(name);
  if (photo) {
    return (
      <Image
        source={{ uri: photo }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.hover }}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: fg, fontWeight: '600', fontSize: size * 0.4 }}>{client.displayName(name).slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

/** Avatar for a chat: a group icon, or the person with a green dot while they are online. */
export function ChatAvatar({ chatKey, size = 44 }: { chatKey: string; size?: number }) {
  if (isGroupKey(chatKey)) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <UsersRound size={size * 0.46} color={colors.accent} strokeWidth={2} />
      </View>
    );
  }
  const dot = Math.max(10, Math.round(size * 0.26));
  // A green ring while they have a status I haven't viewed (grey once viewed), like WhatsApp.
  const ring = client.statusRingOf(chatKey);
  return (
    <View
      style={
        ring && {
          padding: 2,
          borderRadius: size,
          borderWidth: 2.5,
          borderColor: ring === 'new' ? colors.ok : colors.lineStrong,
          margin: -4.5,
        }
      }
    >
      <Avatar name={chatKey} size={size} />
      {client.getPresence(chatKey)?.online && (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: dot,
            height: dot,
            borderRadius: dot / 2,
            backgroundColor: colors.online,
            borderWidth: 2,
            borderColor: colors.surface,
          }}
        />
      )}
    </View>
  );
}

/** "alice is typing…", "alice and bob are typing…" */
export function typingText(names: string[], group: boolean): string {
  if (!names.length) return '';
  if (!group) return 'typing…';
  return names.length === 1 ? `${names[0]} is typing…` : `${names.slice(0, 2).join(' and ')} are typing…`;
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <ShieldCheck size={size * 0.56} color="#fff" strokeWidth={2} />
    </View>
  );
}

export function IconButton({
  icon: Icon,
  onPress,
  disabled,
  color = colors.text2,
  size = 22,
  label,
}: {
  icon: LucideIcon;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  size?: number;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: colors.hover }, disabled && { opacity: 0.35 }]}
    >
      <Icon size={size} color={color} strokeWidth={1.9} />
    </Pressable>
  );
}

/** Screen header with an optional back button. */
export function Header({
  title,
  subtitle,
  onBack,
  left,
  right,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  left?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <View style={s.header}>
      {onBack && <IconButton icon={ChevronLeft} onPress={onBack} label="Back" size={26} />}
      {left}
      <View style={{ flex: 1, paddingLeft: onBack || left ? 0 : 8 }}>
        {typeof title === 'string' ? (
          <Text style={s.title} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        {subtitle}
      </View>
      {right}
    </View>
  );
}

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'secondary',
  icon: Icon,
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: LucideIcon;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? colors.danger : colors.text2;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && { backgroundColor: colors.accent, borderColor: colors.accent },
        variant === 'danger' && { borderColor: '#fda29b' },
        pressed && { opacity: 0.85 },
        (disabled || busy) && { opacity: 0.45 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : Icon ? <Icon size={18} color={fg} strokeWidth={2} /> : null}
      <Text style={{ color: fg, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

/** A text box. Password boxes (secureTextEntry) get an eye button to show / hide what was typed. */
export function Field({ label, ...props }: TextInputProps & { label?: string }) {
  const [shown, setShown] = useState(false);
  const secret = !!props.secureTextEntry;
  return (
    <View>
      {label && <Text style={s.label}>{label}</Text>}
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          {...props}
          secureTextEntry={secret && !shown}
          style={[
            s.input,
            secret && { paddingRight: 46 },
            props.editable === false && { backgroundColor: colors.surface2, color: colors.muted },
            props.style,
          ]}
        />
        {secret && (
          <Pressable
            onPress={() => setShown((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={shown ? 'Hide password' : 'Show password'}
            hitSlop={10}
            style={{ position: 'absolute', right: 12 }}
          >
            {shown ? <EyeOff size={20} color={colors.muted} /> : <Eye size={20} color={colors.muted} />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function Banner({ kind, icon: Icon, children }: { kind: 'error' | 'ok' | 'warn'; icon?: LucideIcon; children: ReactNode }) {
  const [bg, fg, border] =
    kind === 'error'
      ? [colors.dangerSoft, '#b42318', '#fecdca']
      : kind === 'ok'
        ? [colors.okSoft, '#067647', '#abefc6']
        : [colors.warnSoft, colors.warn, '#fedf89'];
  return (
    <View style={[styles.banner, { backgroundColor: bg, borderColor: border }]}>
      {Icon && <Icon size={16} color={fg} style={{ marginTop: 1 }} />}
      <Text style={{ color: fg, fontSize: 13.5, flex: 1, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

/** Grouped list rows (settings style). */
export function Row({
  icon: Icon,
  title,
  subtitle,
  onPress,
  danger,
  right,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: ReactNode;
}) {
  const fg = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.hover }]}
    >
      {Icon && (
        <View style={[styles.rowIcon, danger && { backgroundColor: colors.dangerSoft }]}>
          <Icon size={18} color={danger ? colors.danger : colors.accent} strokeWidth={2} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: fg, fontSize: 15, fontWeight: '500' }}>{title}</Text>
        {subtitle && <Text style={[s.muted, { marginTop: 2 }]}>{subtitle}</Text>}
      </View>
      {right}
    </Pressable>
  );
}

/**
 * The phone's Back button closes this panel (instead of leaving the whole screen) while it is shown.
 * The newest listener wins, so a panel opened on top of another one closes first.
 */
export function useBack(onBack: (() => void) | null | undefined) {
  const ref = useRef(onBack);
  ref.current = onBack;
  const active = !!onBack;
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (ref.current?.(), true));
    return () => sub.remove();
  }, [active]);
}

export type SheetAction = { icon: LucideIcon; label: string; onPress: () => void };

/**
 * Bottom action sheet. Drawn inside the app window (not a RN <Modal>, which on Android is a separate
 * window that FLAG_SECURE does not cover), so screenshots stay blocked.
 */
export function Sheet({ title, actions, onClose }: { title?: string; actions: SheetAction[]; onClose: () => void }) {
  useBack(onClose);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(16,24,40,0.4)' }]} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        {title && <Text style={[s.section, { marginTop: 4, marginLeft: 8 }]}>{title}</Text>}
        {actions.map((a) => (
          <Row
            key={a.label}
            icon={a.icon}
            title={a.label}
            onPress={() => {
              onClose();
              a.onPress();
            }}
          />
        ))}
      </View>
    </View>
  );
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const clock = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "14:05" today, "Mon" this week, otherwise "12/03/26". */
export function shortTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(ts);
  if (now.getTime() - ts < 6 * 86400_000) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]!;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
}

const styles = StyleSheet.create({
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  banner: {
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 12,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 28,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 8,
  },
});

/** "Sort: Name A–Z ▾" chip for any list; the choices open as a sheet. */
export function SortChip<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel="Sort"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: colors.line }}
      >
        <ArrowUpDown size={14} color={colors.muted} />
        <Text style={{ color: colors.text2, fontSize: 13, fontWeight: '600' }}>{options.find(([v]) => v === value)?.[1]}</Text>
      </Pressable>
      {open && (
        <Sheet
          title="Sort by"
          onClose={() => setOpen(false)}
          actions={options.map(([v, label]) => ({ icon: v === value ? Check : ArrowUpDown, label, onPress: () => onChange(v) }))}
        />
      )}
    </>
  );
}

/** Colours for contact details, the same on every screen: department violet, mobile green, email blue, hours amber. */
export const tints = isDark
  ? { dept: ['#bdb4fe', '#2a2350'], phone: ['#75e0a7', '#0f2d20'], email: ['#84caff', '#102a46'], hours: ['#fec84b', '#33270f'] }
  : { dept: ['#6941c6', '#f4f3ff'], phone: ['#067647', '#ecfdf3'], email: ['#175cd3', '#eff8ff'], hours: ['#b54708', '#fffaeb'] };

/** A coloured pill: department, hours, or a tappable mobile number / email. */
export function InfoChip({ kind, icon: Icon, text, onPress }: { kind: keyof typeof tints; icon: LucideIcon; text: string; onPress?: () => void }) {
  const [fg, bg] = tints[kind];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: bg, opacity: pressed ? 0.7 : 1 })}
    >
      <Icon size={14} color={fg} />
      <Text style={{ color: fg, fontWeight: '600', fontSize: 13.5 }}>{text}</Text>
    </Pressable>
  );
}

/** Text where links, email addresses and phone numbers can be tapped (help desk, company information). */
export function RichText({ text, style }: { text: string; style?: object }) {
  return (
    <Text style={[{ color: colors.text2, fontSize: 15, lineHeight: 22 }, style]} selectable>
      {richPieces(text).map((p, i) =>
        p.kind ? (
          <Text
            key={i}
            style={{ fontWeight: '600', color: p.kind === 'phone' ? tints.phone[0] : p.kind === 'email' ? tints.email[0] : colors.accent }}
            onPress={() => void Linking.openURL(p.href!).catch(() => {})}
          >
            {p.text}
          </Text>
        ) : (
          p.text
        ),
      )}
    </Text>
  );
}

/** "2.4 MB" */
export const fileSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
