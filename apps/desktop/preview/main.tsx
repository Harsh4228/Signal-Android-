import { MemoryStorage, MessengerClient } from '@meetme/core';
(window as any).meetme = { platform: 'win32', store: new MemoryStorage() };
const q = new URLSearchParams(location.search);
const SERVER = location.origin;
const until = (f: () => boolean) => new Promise<void>((r) => { const t = setInterval(() => f() && (clearInterval(t), r()), 50); });

async function setup() {
  const { client } = await import('../src/renderer/src/messenger');
  await client.init();
  if (q.get('view') === 'login') return;
  const me = 'harsh' + q.get('n');
  const peers = ['ravi.k' + q.get('n'), 'priya.s' + q.get('n'), 'amit.d' + q.get('n')];
  await client.register(SERVER, me);
  client.connect();
  await until(() => client.status === 'online');
  const others: MessengerClient[] = [];
  for (const p of peers) {
    const o = new MessengerClient(new MemoryStorage());
    await o.init(); await o.register(SERVER, p); o.connect();
    await until(() => o.status === 'online');
    others.push(o);
  }
  const [ravi, priya, amit] = others as [MessengerClient, MessengerClient, MessengerClient];
  await amit.addContact(me); await amit.sendText(me, 'Can we move the review to 4 pm?');
  await priya.addContact(me); await priya.sendText(me, 'Sent you the updated contract draft.');
  await ravi.addContact(me);
  await ravi.sendText(me, 'Hi Harsh, the quarterly report is ready for review.');
  await until(() => client.contacts.includes(peers[0]!));
  await client.sendText(peers[0]!, 'Great, thanks Ravi. I will go through it this afternoon.');
  await ravi.sendText(me, 'Sure. I also added the revenue breakdown by region on page 4.');
  await client.sendText(peers[0]!, 'Perfect. Let us discuss it in the 3 pm call.');
  await until(() => client.getMessages(peers[0]!).length >= 4);
  client.setActiveChat(peers[0]!);
  if (q.get('lock')) {
    const { appLock } = await import('../src/renderer/src/messenger');
    await appLock.setPin('123456');
    if (q.get('lock') === 'locked') appLock.lock();
  }
}
setup().then(async () => {
  const { createRoot } = await import('react-dom/client');
  const { App } = await import('../src/renderer/src/App');
  await import('@fontsource-variable/inter');
  await import('../src/renderer/src/styles.css');
  createRoot(document.getElementById('root')!).render(<App />);
  (window as any).__ready = true;
}).catch((e) => { document.body.textContent = 'SETUP FAILED: ' + e; (window as any).__ready = true; });
