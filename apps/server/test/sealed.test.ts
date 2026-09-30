import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

let srv: Awaited<ReturnType<typeof startTestServer>>;
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: true });
});
after(async () => {
  clients.forEach((c) => c.dispose());
  await new Promise((r) => setTimeout(r, 100));
  await srv.close();
});

async function waitFor(fn: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function newClient(name: string, storage = new MemoryStorage()) {
  const c = new MessengerClient(storage);
  clients.push(c);
  if (!(await c.init())) await c.register(srv.url, name);
  c.connect();
  await waitFor(() => c.status === 'online', `${name} online`);
  return c;
}
const texts = (c: MessengerClient, peer: string) => c.getMessages(peer).filter((m) => !m.system).map((m) => m.text);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('sealed sender: after the first exchange the server no longer knows who sent a message', async () => {
  const alice = await newClient('alice');
  const bobStorage = new MemoryStorage();
  let bob = await newClient('bob', bobStorage);
  await sleep(300); // sealed-sender setup (certificate, delivery key) runs after connecting

  // First contact: delivery keys travel inside the encrypted messages.
  await alice.addContact('bob');
  await alice.sendText('bob', 'hi bob');
  await waitFor(() => texts(bob, 'alice').includes('hi bob'), 'first message');
  await bob.sendText('alice', 'hi alice');
  await waitFor(() => texts(alice, 'bob').includes('hi alice'), 'reply');

  // Bob goes offline so messages stay in the queue where we can inspect them.
  bob.dispose();
  await sleep(150);
  await alice.sendText('bob', 'sealed one');
  await alice.sendText('bob', 'sealed two');
  await sleep(200);
  const rows = await srv.queueRows();
  const forBob = rows.slice(-2);
  assert.equal(forBob.length, 2);
  for (const r of forBob) {
    assert.equal(r.sender, '', 'server does not know the sender');
    assert.ok(!r.body.includes('alice'), 'sender name not in the stored blob');
  }

  // Bob comes back: messages arrive, attributed to alice (from the certificate), in order.
  bob = await newClient('bob', bobStorage);
  await waitFor(() => texts(bob, 'alice').includes('sealed two'), 'sealed delivery');
  const got = texts(bob, 'alice');
  assert.ok(got.indexOf('sealed one') < got.indexOf('sealed two'));
  // Read receipts also travel sealed, and ticks still work.
  await waitFor(
    () => alice.getMessages('bob').some((m) => m.text === 'sealed two' && (m.status === 'delivered' || m.status === 'read')),
    'receipt back to alice',
  );
});

test('sealed endpoint: no delivery key, wrong key or unknown user all get the same 401', async () => {
  const carol = await newClient('carol');
  await sleep(300);
  const post = (to: string, key?: string) =>
    fetch(`${srv.url}/v1/sealed/${to}`, {
      method: 'POST',
      headers: key ? { 'x-delivery-key': key } : {},
      body: '{"v":1,"sealed":1,"e":"","s":"","c":""}',
    });
  const wrong = Buffer.alloc(32, 7).toString('base64');
  for (const res of [await post('carol'), await post('carol', wrong), await post('nobody_here', wrong)]) {
    assert.equal(res.status, 401);
    assert.equal(await res.text(), 'unauthorized');
  }
  assert.equal(carol.status, 'online');
});
