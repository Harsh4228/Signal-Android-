// CellMate web app: keeps the app's own files so it opens fast and without a network. Never caches the API,
// messages or attachments (those are end-to-end encrypted and handled by the app itself).
const CACHE = 'cellmate-app-v2';
// Things shared to CellMate from another app (the web app installed on Android), until the app takes them.
const SHARE_CACHE = 'cellmate-share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE && n !== SHARE_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // "Share" -> CellMate (Android): keep what was shared on this device, then open the app to choose the chats.
  if (event.request.method === 'POST' && url.origin === location.origin && url.pathname === '/app/share-target') {
    event.respondWith(
      (async () => {
        try {
          const form = await event.request.formData();
          await caches.delete(SHARE_CACHE);
          const cache = await caches.open(SHARE_CACHE);
          const files = [];
          let i = 0;
          for (const f of form.getAll('files').slice(0, 20)) {
            if (!(f instanceof File) || !f.size) continue;
            const key = `/app/share-inbox/${i++}`;
            await cache.put(key, new Response(f));
            files.push({ key, name: f.name || 'file', mime: f.type || 'application/octet-stream' });
          }
          const text = ['title', 'text', 'url']
            .map((k) => form.get(k))
            .filter((v) => typeof v === 'string' && v.trim())
            .filter((v, idx, all) => all.indexOf(v) === idx)
            .join('\n');
          await cache.put('/app/share-inbox/manifest.json', new Response(JSON.stringify({ files, text, ts: Date.now() })));
        } catch {
          /* nothing usable was shared: just open the app */
        }
        return Response.redirect('/app/?shared=1', 303);
      })(),
    );
    return;
  }
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
// Web Push from the CellMate server: it only says "message" or "call", never who or what.
self.addEventListener('push', (event) => {
  let kind = 'message';
  try {
    kind = event.data?.json()?.t === 'call' ? 'call' : 'message';
  } catch {
    /* no data: a message */
  }
  const call = kind === 'call';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // The app is open and in front: it shows the message itself.
      if (wins.some((w) => w.visibilityState === 'visible')) return;
      return self.registration.showNotification('CellMate', {
        body: call ? 'Incoming call' : 'New message',
        tag: call ? 'cellmate-call' : 'cellmate-message',
        renotify: true,
        icon: '/app/icon-192.png',
        badge: '/app/icon-192.png',
        requireInteraction: call,
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url.includes('/app/'));
      return open ? open.focus() : self.clients.openWindow('/app/');
    }),
  );
});