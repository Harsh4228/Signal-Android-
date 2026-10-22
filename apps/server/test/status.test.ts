import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, STATUS_COLORS, STATUS_TTL_MS, randomBytes } from '@meetme/core';
import { startTestServer } from './harness';

// Status (like WhatsApp): goes to my contacts and group members, end-to-end encrypted, gone after 24 hours.
let srv: Awaited<ReturnType<typeof startTestServer>>;
let url = '';
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['admin'], openRegistration: false });
  url = srv.url;
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

async function device(storage = new MemoryStorage()) {
  const c = new MessengerClient(storage);
  clients.push(c);
  await c.init();
  return c;
}

async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}

test('status reaches contacts and group members, shows who viewed it, can be deleted, and expires', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  const storage: Record<string, MemoryStorage> = {};
  const p: Record<string, MessengerClient> = {};
  for (const name of ['asha', 'bina', 'chirag', 'dev']) {
    await admin.createEmployee(name, 'temp-password-1');
    storage[name] = new MemoryStorage();
    p[name] = await device(storage[name]);
    await p[name].login(url, name, 'temp-password-1', `${name}-own-secret`);
    await online(p[name]);
  }
  const { asha, bina, chirag, dev } = p as Record<string, MessengerClient>;

  // Asha chats with Bina, and is in a group with Chirag. Dev is a stranger.
  await asha!.sendText('bina', 'hi');
  await waitFor(() => bina!.contacts.includes('asha'), 'bina knows asha');
  await admin.createGroup('Team', ['asha', 'chirag']);
  await waitFor(() => asha!.groups.length === 1 && chirag!.groups.length === 1, 'group loaded');
  assert.deepEqual(asha!.statusAudience(), ['bina', 'chirag']); // the admin made the group but isn't in it

  const r = await asha!.postStatus({ text: 'Working from home today', bg: STATUS_COLORS[2] });
  assert.deepEqual(r, { sent: 2, failed: [] });
  for (const c of [bina!, chirag!]) await waitFor(() => c.statusGroups().some((g) => g.user === 'asha'), 'status arrives');
  const got = bina!.statusGroups()[0]!;
  assert.equal(got.items[0]!.text, 'Working from home today');
  assert.equal(got.items[0]!.bg, STATUS_COLORS[2]);
  assert.equal(got.allSeen, false);
  assert.equal(bina!.unseenStatusCount, 1);
  assert.equal(dev!.statusGroups().length, 0);

  // A photo status: the photo is encrypted on the server, the viewer decrypts it.
  const jpg = randomBytes(4000);
  await asha!.postStatus({ photo: { name: 'view.jpg', mime: 'image/jpeg', data: jpg }, caption: 'nice view' });
  await waitFor(() => bina!.statusGroups()[0]?.items.length === 2, 'photo status');
  const photo = bina!.statusGroups()[0]!.items[1]!;
  assert.equal(photo.text, 'nice view');
  assert.deepEqual(await bina!.statusPhoto(photo), jpg);
  await assert.rejects(asha!.postStatus({ photo: { name: 'a.pdf', mime: 'application/pdf', data: jpg } }), /must be an image/);

  // Viewing: the poster sees who viewed it.
  bina!.markStatusSeen(got.items[0]!.id, 'asha');
  await waitFor(() => !!asha!.myStatuses()[0]!.viewers?.bina, 'asha sees bina viewed it');
  assert.equal(asha!.myStatuses()[0]!.viewers?.chirag, undefined);
  assert.equal(bina!.statusGroups()[0]!.allSeen, false); // the photo is still unviewed
  bina!.markStatusSeen(photo.id, 'asha');
  assert.equal(bina!.unseenStatusCount, 0);

  // Survives a restart (kept in the encrypted store).
  bina!.dispose();
  const bina2 = await device(storage.bina);
  assert.equal(bina2.statusGroups()[0]!.items.length, 2);
  assert.equal(bina2.statusGroups()[0]!.allSeen, true);
  await online(bina2);

  // Deleting removes it from everyone.
  await asha!.deleteStatus(photo.id);
  await waitFor(() => chirag!.statusGroups()[0]?.items.length === 1, 'deleted on chirag');
  await waitFor(() => bina2.statusGroups()[0]?.items.length === 1, 'deleted on bina');
  assert.equal(asha!.myStatuses().length, 1);

  // Someone who doesn't know Asha can't push a status to her.
  const d = dev! as unknown as { sendPayload(peer: string, p: unknown): Promise<void> };
  await d.sendPayload('asha', { k: 'status', id: 'cd'.repeat(16), text: 'spam', ts: Date.now() });
  await dev!.sendText('asha', 'after the spam');
  await waitFor(() => asha!.getMessages('dev').some((m) => m.text === 'after the spam'), 'asha gets the text');
  assert.ok(!asha!.statusGroups().some((g) => g.user === 'dev'));

  // After 24 hours it is gone everywhere.
  const realNow = Date.now;
  Date.now = () => realNow() + STATUS_TTL_MS + 1000;
  try {
    await waitFor(() => !chirag!.statusGroups().length && !asha!.myStatuses().length, 'expired', 3000);
  } finally {
    Date.now = realNow;
  }
});
