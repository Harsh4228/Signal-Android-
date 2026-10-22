import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { MemoryStorage, MessengerClient, type CallSignal } from '@meetme/core';
import { startTestServer } from './harness';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let url = '';
let dir = '';
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({
    stunUrls: ['stun:stun.example.org'],
    turnUrls: [],
    trustProxy: false,
    adminUsers: ['boss', 'ops'],
    openRegistration: true,
  });
  ({ url, dir } = srv);
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
  if (!(await c.init())) await c.register(url, name);
  c.connect();
  await waitFor(() => c.status === 'online', `${name} online`);
  return c;
}

const texts = (c: MessengerClient, peer: string) =>
  c.getMessages(peer).filter((m) => !m.system).map((m) => m.text);

test('register, message, reply, receipts, offline delivery, timers, call signaling', async () => {
  const alice = await newClient('alice');
  const bobStorage = new MemoryStorage();
  let bob = await newClient('bob', bobStorage);

  await assert.rejects(alice.addContact('nobody_here'), /not found/);
  await alice.addContact('bob');

  // --- first message (X3DH prekey message) ---
  await alice.sendText('bob', 'hello bob');
  await waitFor(() => texts(bob, 'alice').includes('hello bob'), 'bob receives');
  assert.deepEqual(bob.contacts, ['alice']);
  await waitFor(() => alice.getMessages('bob')[0]?.status === 'delivered', 'delivered receipt');

  bob.setActiveChat('alice');
  await waitFor(() => alice.getMessages('bob')[0]?.status === 'read', 'read receipt');

  await bob.sendText('alice', 'hi alice');
  await waitFor(() => texts(alice, 'bob').includes('hi alice'), 'alice receives');

  // --- offline delivery: bob goes away, comes back with the same (persisted) keys ---
  bob.dispose();
  await waitFor(() => bob.status === 'offline', 'bob offline');
  await alice.sendText('bob', 'while you were away');
  bob = await newClient('bob', bobStorage);
  await waitFor(() => texts(bob, 'alice').includes('while you were away'), 'queued delivery');

  // --- the server never sees plaintext ---
  await alice.sendText('bob', 'TOP SECRET');
  assert.ok((await srv.queueBodies()).every((b) => !b.includes('TOP SECRET')));
  await waitFor(() => texts(bob, 'alice').includes('TOP SECRET'), 'secret delivered');

  // --- disappearing messages sync to the other side (an admin allows them first; off by default) ---
  const ops = await newClient('ops');
  await waitFor(() => ops.isAdmin, 'ops is admin');
  await ops.setPolicy({ allowClearHistory: true });
  await waitFor(() => alice.canClearHistory && bob.canClearHistory, 'policy reached both');
  await alice.setDisappearingTimer('bob', 1);
  await waitFor(() => bob.getDisappearingTimer('alice') === 1, 'timer synced');
  await alice.sendText('bob', 'self destruct');
  await waitFor(() => texts(bob, 'alice').includes('self destruct'), 'ephemeral received');
  await waitFor(() => !texts(bob, 'alice').includes('self destruct'), 'ephemeral removed on bob', 4000);
  await waitFor(() => !texts(alice, 'bob').includes('self destruct'), 'ephemeral removed on alice', 4000);

  // --- call signaling is carried inside the encrypted channel ---
  const got: CallSignal[] = [];
  bob.on('callSignal', (_from, s) => got.push(s));
  await alice.sendCallSignal('bob', { k: 'call', callId: 'c1', action: 'offer', video: true, sdp: 'v=0 fake' });
  await waitFor(() => got.length === 1, 'call signal');
  assert.equal(got[0]!.sdp, 'v=0 fake');

  // --- safety numbers match on both sides ---
  const sa = await alice.getSafetyNumber('bob');
  const sb = await bob.getSafetyNumber('alice');
  assert.equal(sa!.number, sb!.number);

  const ice = await alice.getIceConfig();
  assert.equal(ice.relayOnly, false);
});

test('admin broadcast reaches every employee, replies go back 1:1, badge cannot be faked', async () => {
  const boss = await newClient('boss');
  const emp1 = await newClient('emp1');
  const emp2Storage = new MemoryStorage();
  let emp2 = await newClient('emp2', emp2Storage);
  await waitFor(() => boss.isAdmin, 'boss is admin');
  assert.equal(emp1.isAdmin, false);
  await assert.rejects(emp1.broadcast('fake'), /Only admins/);
  await assert.rejects(emp1.listAllUsers(), /admin only/);

  // emp2 is offline during the broadcast and must still get it (with the badge) later.
  emp2.dispose();
  await waitFor(() => emp2.status === 'offline', 'emp2 offline');

  const res = await boss.broadcast('Office closed tomorrow');
  assert.ok(res.sent >= 2, `sent to ${res.sent}`);
  assert.deepEqual(res.failed, []);

  const announcement = (c: MessengerClient) =>
    c.getMessages('boss').find((m) => m.text === 'Office closed tomorrow');
  await waitFor(() => !!announcement(emp1), 'emp1 got broadcast');
  assert.equal(announcement(emp1)!.broadcast, true);

  emp2 = await newClient('emp2', emp2Storage);
  await waitFor(() => !!announcement(emp2), 'offline emp2 got broadcast');
  assert.equal(announcement(emp2)!.broadcast, true);

  // Reply goes privately to the admin.
  await emp1.sendText('boss', 'ok thanks');
  await waitFor(() => boss.getMessages('emp1').some((m) => m.text === 'ok thanks'), 'boss got reply');
  assert.equal(emp2.getMessages('emp1').length, 0);

  // A normal user setting the flag by hand does NOT get the announcement badge.
  await (emp1 as unknown as { sendPayload: Function }).sendPayload('emp2', {
    k: 'text',
    id: 'x1',
    text: 'I am the boss',
    ts: Date.now(),
    bc: true,
  });
  await waitFor(() => emp2.getMessages('emp1').some((m) => m.text === 'I am the boss'), 'spoof delivered');
  assert.equal(emp2.getMessages('emp1').find((m) => m.text === 'I am the boss')!.broadcast, undefined);
});

test('photos / PDFs / files: encrypted on the server, decrypted in memory, broadcast too', async () => {
  const boss = await newClient('boss2');
  const a = await newClient('filea');
  const b = await newClient('fileb');

  const pdf = new TextEncoder().encode('%PDF-1.4 SECRET-CONTRACT-TEXT ' + 'x'.repeat(200_000));
  await a.sendFile('fileb', { name: 'contract.pdf', mime: 'application/pdf', data: pdf }, 'please sign');
  const got = () => b.getMessages('filea').find((m) => m.attachment?.name === 'contract.pdf');
  await waitFor(() => got()?.attachment?.state === 'ready', 'pdf decrypted');
  assert.equal(got()!.attachment!.kind, 'pdf');
  assert.equal(got()!.text, 'please sign');
  assert.deepEqual(got()!.attachment!.data, pdf);

  // The server only holds ciphertext.
  const { readdirSync, readFileSync } = await import('node:fs');
  const attDir = join(dir, 'attachments');
  for (const f of readdirSync(attDir)) {
    const raw = readFileSync(join(attDir, f)).toString('latin1');
    assert.ok(!raw.includes('SECRET-CONTRACT-TEXT'));
  }

  // Photo
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...crypto.getRandomValues(new Uint8Array(5000))]);
  await b.sendFile('filea', { name: 'pic.png', mime: 'image/png', data: png });
  await waitFor(
    () => a.getMessages('fileb').some((m) => m.attachment?.kind === 'image' && m.attachment.state === 'ready'),
    'photo received',
  );

  // Too large / hostile metadata is rejected.
  await assert.rejects(
    a.sendFile('fileb', { name: 'big.bin', mime: 'application/zip', data: new Uint8Array(26 * 1024 * 1024) }),
    /too large/,
  );

  // Admin broadcast with a file: uploaded once, readable by everyone.
  await waitFor(() => boss.isAdmin === false, 'boss2 not admin'); // boss2 is not in ADMIN list
  const realBoss = clients.find((c) => c.account?.username === 'boss')!;
  const r = await realBoss.broadcast('Holiday list', { name: 'holidays.pdf', mime: 'application/pdf', data: pdf });
  assert.deepEqual(r.failed, []);
  await waitFor(
    () =>
      b.getMessages('boss').some((m) => m.broadcast && m.attachment?.name === 'holidays.pdf' && m.attachment.state === 'ready'),
    'broadcast file received',
  );
});

test('rejects bad credentials and duplicate usernames', async () => {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  await assert.rejects(c.register(url, 'alice'), /taken/);
  const res = await fetch(`${url}/v1/keys/alice`, {
    headers: { authorization: 'Basic ' + Buffer.from('alice:wrongpasswordwrongpasswordwrong').toString('base64') },
  });
  assert.equal(res.status, 401);
});
