import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

const servers: Awaited<ReturnType<typeof startTestServer>>[] = [];
const clients: MessengerClient[] = [];

after(async () => {
  clients.forEach((c) => c.dispose());
  await new Promise((r) => setTimeout(r, 100));
  for (const s of servers) await s.close();
});

async function waitFor(fn: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

async function start(publicUrl?: string, port?: number) {
  const srv = await startTestServer(
    { stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: true, publicUrl },
    { port },
  );
  servers.push(srv);
  return srv;
}

async function online(name: string, url: string, storage = new MemoryStorage()) {
  const c = new MessengerClient(storage);
  clients.push(c);
  if (!(await c.init())) await c.register(url, name);
  c.connect();
  await waitFor(() => c.status === 'online', `${name} online`);
  return c;
}

test('after a domain change, apps move to the new address and keep their account', async () => {
  const port = await freePort();
  const oldUrl = `http://127.0.0.1:${port}`;
  const newUrl = `http://localhost:${port}`; // same server, second name
  await start(newUrl, port);

  const storage = new MemoryStorage();
  const alice = await online('alice', oldUrl, storage);
  const bob = await online('bob', newUrl);

  await waitFor(() => alice.account?.serverUrl === newUrl, 'alice moves to the new address');
  await waitFor(() => alice.status === 'online', 'alice back online');

  // Still the same account: messages flow both ways.
  await alice.sendText('bob', 'hello from the new address');
  await waitFor(() => bob.getMessages('alice').some((m) => m.text === 'hello from the new address'), 'bob gets it');

  // The new address was saved: the app starts on it next time.
  const again = new MessengerClient(storage);
  clients.push(again);
  await again.init();
  assert.equal(again.account?.serverUrl, newUrl);
});

test('an announced address that is a different server is ignored', async () => {
  const other = await start(); // separate server, separate database
  const srv = await start(other.url);
  const carol = await online('carol', srv.url);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(carol.account?.serverUrl, srv.url);
  assert.equal(carol.status, 'online');
});
