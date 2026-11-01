/** Light / dark: "system" follows the computer (or phone, in the web app). Kept per device. */
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'cellmate:theme';
/** Desktop app: the choice saved by the app (the bridge object is read-only, so changes are kept here). */
let desktopChoice: string | undefined;

export function getTheme(): ThemeChoice {
  try {
    // Desktop app: kept by the app itself (its window storage is in memory only and gone after a restart).
    const v = window.meetme?.saveTheme ? (desktopChoice ?? window.meetme.theme) : localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const dark = matchMedia('(prefers-color-scheme: dark)');

function apply() {
  const choice = getTheme();
  const isDark = choice === 'dark' || (choice === 'system' && dark.matches);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark ? '#111b21' : '#1d4ed8');
}

export function setTheme(choice: ThemeChoice) {
  if (window.meetme?.saveTheme) {
    desktopChoice = choice;
    void window.meetme.saveTheme(choice).catch(() => {});
  } else {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* private window: just for now */
    }
  }
  apply();
}

/** Once at start: apply, and follow the system while "system" is chosen. */
export function initTheme() {
  apply();
  dark.addEventListener('change', apply);
}