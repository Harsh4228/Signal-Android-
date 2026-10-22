import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, groupKey } from '@meetme/core';
import { startTestServer } from './harness';

// Groups where only chosen members can send; everyone else reads.
let srv: Awaited<ReturnType<typeof startTestServer>>;
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['admin'], openRegistration: false });
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

async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}

async function fresh() {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  return c;
}

const texts = (c: MessengerClient, key: string) => c.getMessages(key).filter((m) => !m.system).map((m) => m.text);

test('only the chosen senders can write; the others read; admins always can', async () => {
  const admin = await fresh();
  await admin.register(srv.url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin');
  const people: Record<string, MessengerClient> = {};
  for (const n of ['asha', 'bina', 'chirag']) {
    await admin.createEmployee(n, 'temp-password-1');
    const c = await fresh();
    await c.login(srv.url, n, 'temp-password-1', `${n}-own-secret`);
    people[n] = await online(c);
  }
  const { asha, bina, chirag } = people as Record<string, MessengerClient>;

  // Only asha may send (plus the admin); "zed" isn't a member, so it's dropped from the list.
  const g = await admin.createGroup('Notices', ['admin', 'asha', 'bina', 'chirag'], ['asha', 'zed']);
  assert.deepEqual(g.senders, ['asha']);
  const key = groupKey(g.id);
  await waitFor(() => [asha, bina, chirag].every((c) => !!c!.groupOf(key)), 'everyone sees the group');

  assert.equal(asha!.canSendTo(key), true);
  assert.equal(bina!.canSendTo(key), false);
  assert.equal(admin.canSendTo(key), true);

  await asha!.sendText(key, 'from asha');
  await admin.sendText(key, 'from admin');
  await waitFor(() => ['from asha', 'from admin'].every((t) => texts(bina!, key).includes(t)), 'bina reads both');

  // A read-only member can't send...
  await assert.rejects(bina!.sendText(key, 'from bina'), /Only selected members can send/);
  // ...and if a modified app sends anyway, the others drop it.
  const raw = bina as unknown as { sendToChat(k: string, p: object): Promise<void> };
  await raw.sendToChat(key, { k: 'text', id: 'sneaky-1', text: 'sneaky' });
  await asha!.sendText(key, 'after sneaky');
  await waitFor(() => texts(chirag!, key).includes('after sneaky'), 'chirag got the later message');
  assert.ok(!texts(chirag!, key).includes('sneaky'));
  assert.ok(!texts(asha!, key).includes('sneaky'));

  // The admin changes the rule: everyone can send now.
  await admin.updateGroup(g.id, { senders: null });
  await waitFor(() => bina!.canSendTo(key), 'bina may send now');
  await bina!.sendText(key, 'bina can talk');
  await waitFor(() => texts(asha!, key).includes('bina can talk'), 'asha got it');

  // Renaming alone keeps the rule; removing a sender from the group removes them from the senders.
  await admin.updateGroup(g.id, { senders: ['asha', 'chirag'] });
  await admin.updateGroup(g.id, { name: 'Notice board' });
  assert.deepEqual((await admin.listAllGroups()).find((x) => x.id === g.id)!.senders, ['asha', 'chirag']);
  await admin.updateGroup(g.id, { members: ['admin', 'asha', 'bina'] });
  assert.deepEqual((await admin.listAllGroups()).find((x) => x.id === g.id)!.senders, ['asha']);

  // "Only admins": an empty list.
  await admin.updateGroup(g.id, { senders: [] });
  await waitFor(() => !asha!.canSendTo(key), 'asha read-only now');
  assert.equal(admin.canSendTo(key), true);
  assert.ok((await admin.getAuditLog()).some((e) => e.detail.includes('only these can send: admins')));
});
