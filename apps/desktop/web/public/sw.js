// CellMate web app: keeps the app's own files so it opens fast and without a network. Never caches the API,
// messages or attachments (those are end-to-end encrypted and handled by the app itself).
const CACHE = 'cellmate-app-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/app/')) return;
  const page = event.request.mode === 'navigate' || url.pathname === '/app/' || url.pathname.endsWith('.html');
  if (page) {
    // The page: newest from the network, the saved copy when offline.
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put('/app/', copy));
          return res;
        })
        .catch(() => caches.match('/app/')),
    );
    return;
  }
  // Scripts, styles, icons: their names change with every version, so a saved copy is always right.
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});