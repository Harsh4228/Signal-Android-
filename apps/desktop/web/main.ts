// The desktop UI in a browser. `npm run web` (dev): with no Electron preload, messenger.ts uses a per-tab store so
// each tab can be another user. Production build (`npm run build:web`): the web app for iPhone and any browser,
// served by the CellMate server at /app/ (data encrypted in IndexedDB, see webStore.ts).
import '../src/renderer/src/main';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {}));
}