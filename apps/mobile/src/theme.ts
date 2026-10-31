import { Appearance, NativeModules, Platform, StyleSheet } from 'react-native';

/** Light theme. Keep in sync with apps/desktop/src/renderer/src/styles.css. */
const LIGHT = {
  // Blue and white, green for what's new / online, near-black text.
  bg: '#eaf1fc',
  surface: '#ffffff',
  surface2: '#f4f8fe',
  hover: '#e8f0fd',
  line: '#d9e3f3',
  lineStrong: '#bccbe6',
  text: '#0b1324',
  text2: '#1e2a40',
  muted: '#55657f',
  faint: '#8b9ab3',
  accent: '#1d4ed8',
  accentSoft: '#e2ebff',
  accentText: '#1e3a8a',
  out: '#dbe7ff',
  outBorder: '#c7d8fb',
  in: '#ffffff',
  danger: '#d92d20',
  dangerSoft: '#fef3f2',
  ok: '#16a34a',
  okSoft: '#e7f8ee',
  online: '#16a34a',
  warn: '#b54708',
  warnSoft: '#fffaeb',
};

/** Dark theme (like WhatsApp's), used when the phone is in dark mode. */
const DARK: typeof LIGHT = {
  bg: '#0b141a',
  surface: '#111b21',
  surface2: '#1a242b',
  hover: '#202c33',
  line: '#222e35',
  lineStrong: '#2f3d45',
  text: '#e9edef',
  text2: '#cfd6da',
  muted: '#8696a0',
  faint: '#667781',
  accent: '#4f80ff',
  accentSoft: '#17264a',
  accentText: '#a9c1ff',
  out: '#1c3157',
  outBorder: '#25406d',
  in: '#1a242b',
  danger: '#f15c6d',
  dangerSoft: '#3a1d22',
  ok: '#21c063',
  okSoft: '#12301f',
  online: '#21c063',
  warn: '#f5a524',
  warnSoft: '#33270f',
};

/**
 * Dark or light, chosen when the app starts (styles are made once): the Settings choice, or the phone's own mode.
 */
/** Light / Dark / System (Settings > Appearance); saved on the phone, read when the app starts. */
export type ThemeChoice = 'system' | 'light' | 'dark';
export const themeChoice: ThemeChoice = ((NativeModules.DeviceFiles as { theme?: ThemeChoice } | undefined)?.theme ?? 'system') as ThemeChoice;
export const isDark = themeChoice === 'dark' || (themeChoice === 'system' && Appearance.getColorScheme() === 'dark');

/** Save the choice and start the app again so every screen uses the new colours. */
export async function chooseTheme(t: ThemeChoice): Promise<void> {
  const m = NativeModules.DeviceFiles as { setTheme?(t: string): Promise<void>; restart?(): void } | undefined;
  if (!m?.setTheme) throw new Error('Not available on this phone');
  await m.setTheme(t);
  m.restart?.();
}
export const colors = isDark ? DARK : LIGHT;

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

export const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { color: colors.text, fontSize: 15 },
  textStrong: { color: colors.text, fontSize: 15, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13 },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  section: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 24,
    marginBottom: 10,
  },
  label: { color: colors.text2, fontSize: 13, fontWeight: '500', marginBottom: 6 },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    minHeight: 60,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.lineStrong,
    gap: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
});
