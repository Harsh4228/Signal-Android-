import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

// Notices: the admin sends one to everyone, departments or groups; it pops up until the employee clicks OK,
// the OK goes back to the admin, and both keep the notice list across app restarts.
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

async function fresh(storage = new MemoryStorage()) {
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

const titles = (c: MessengerClient) => c.pendingNotices().map((n) => n.title);

test('notices reach the chosen departments and groups, pop up until OK, and the admin sees who read them', async () => {
  const admin = await fresh();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  await admin.addDepartment('Sales');
  await admin.addDepartment('Support');

  const people: Record<string, MessengerClient> = {};
  const storageOf: Record<string, MemoryStorage> = {};
  for (const [name, depts] of [
    ['asha', ['Sales']],
    ['bina', ['Support']],
    ['chirag', []],
    ['dev', []],
  ] as const) {
    await admin.createEmployee(name, 'temp-password-1', [...depts]);
    storageOf[name] = new MemoryStorage();
    const c = await fresh(storageOf[name]);
    await c.login(url, name, 'temp-password-1', `${name}-own-secret`);
    people[name] = await online(c);
  }
  const night = await admin.createGroup('Night shift', ['admin', 'chirag']);

  // Sales + the Night shift group: asha and chirag, not bina or dev.
  const r = await admin.sendNotice('Office closed', 'Closed on Friday.', { departments: ['Sales'], groups: [night.id] });
  assert.deepEqual(r, { sent: 2, failed: [] });
  await waitFor(() => titles(people.asha!).includes('Office closed'), 'asha');
  await waitFor(() => titles(people.chirag!).includes('Office closed'), 'chirag');
  const sent = admin.getNotices()[0]!;
  assert.equal(sent.outgoing, true);
  assert.equal(sent.audience, 'Sales, Night shift');
  assert.deepEqual([...sent.recipients!].sort(), ['asha', 'chirag']);

  // To everyone; proves bina's and dev's queues are drained, so the first notice never reached them.
  await admin.sendNotice('All hands', 'Meeting at 4.');
  for (const n of ['asha', 'bina', 'chirag', 'dev']) await waitFor(() => titles(people[n]!).includes('All hands'), n);
  assert.deepEqual(titles(people.bina!), ['All hands']);
  assert.deepEqual(titles(people.asha!), ['Office closed', 'All hands']); // oldest first

  // OK: it stops popping up, stays in the list, and the admin sees it.
  const asha = people.asha!;
  const first = asha.pendingNotices()[0]!;
  assert.equal(first.from, 'admin');
  assert.equal(first.text, 'Closed on Friday.');
  await asha.acknowledgeNotice(first.id);
  assert.deepEqual(titles(asha), ['All hands']);
  assert.ok(asha.getNotices().some((n) => n.id === first.id && n.okAt));
  await waitFor(() => !!admin.getNotices().find((n) => n.id === first.id)!.okBy?.asha, 'OK reaches the admin');
  assert.equal(admin.getNotices().find((n) => n.id === first.id)!.okBy?.chirag, undefined);

  // Restarting the app keeps the list and what is still unread.
  asha.dispose();
  const again = await fresh(storageOf.asha);
  assert.deepEqual(titles(again), ['All hands']);
  assert.equal(again.getNotices().length, 2);

  // Only admins can send notices.
  await assert.rejects(people.bina!.sendNotice('Fake', 'Free pizza'), /Only admins/);
  await assert.rejects(admin.sendNotice('  ', ' '), /empty/);
  await assert.rejects(admin.sendNotice('x', 'y', { departments: ['Nowhere'] }), /Nobody in those departments/);

  // A modified app sends one anyway, straight through the encrypted channel: it is ignored.
  const bina = people.bina! as unknown as { sendPayload(peer: string, p: unknown): Promise<void> };
  await bina.sendPayload('dev', { k: 'notice', id: 'ab'.repeat(16), title: 'Fake', text: 'Free pizza', ts: Date.now() });
  await people.bina!.sendText('dev', 'after the fake');
  await waitFor(() => people.dev!.getMessages('bina').some((m) => m.text === 'after the fake'), 'dev gets the text');
  assert.ok(!people.dev!.getNotices().some((n) => n.title === 'Fake'));
});
