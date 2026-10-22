import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, groupKey, inviteCode, type Payload } from '@meetme/core';
import { startTestServer } from './harness';

let srv: Awaited<ReturnType<typeof startTestServer>>;
let url = '';
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({
    stunUrls: [],
    turnUrls: [],
    trustProxy: false,
    adminUsers: ['boss'],
    openRegistration: true,
  });
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

async function newClient(name: string, storage = new MemoryStorage()) {
  const c = new MessengerClient(storage);
  clients.push(c);
  if (!(await c.init())) await c.register(url, name);
  c.connect();
  await waitFor(() => c.status === 'online', `${name} online`);
  return c;
}

const texts = (c: MessengerClient, key: string) =>
  c.getMessages(key).filter((m) => !m.system).map((m) => (m.deleted ? '<deleted>' : m.text));

test('admin: user list, stats, ban / unban, audit log; non-admins are refused', async () => {
  const boss = await newClient('boss');
  const emp1 = await newClient('emp1');
  const emp2Storage = new MemoryStorage();
  let emp2 = await newClient('emp2', emp2Storage);
  await waitFor(() => boss.isAdmin, 'boss is admin');

  await assert.rejects(emp1.getAdminStats(), /admin only/);
  await assert.rejects(emp1.setBanned('emp2', true), /admin only/);
  await assert.rejects(emp1.createGroup('x', []), /admin only/);
  await assert.rejects(emp1.getAuditLog(), /admin only/);

  const users = await boss.listAllUsers();
  const e2 = users.find((u) => u.username === 'emp2')!;
  assert.equal(e2.online, true);
  assert.equal(e2.banned, false);
  assert.ok(e2.createdAt > 0);

  await assert.rejects(boss.setBanned('boss', true), /yourself/);

  // --- ban: emp2 is signed out for good (the app deletes its keys), nobody can message them ---
  await boss.setBanned('emp2', true);
  await waitFor(() => emp2.account === null, 'emp2 signed out and keys wiped');
  await emp1.addContact('emp2');
  await assert.rejects(emp1.sendText('emp2', 'hi'), /suspended|not logged in|can't receive|no keys|not found/i);

  let stats = await boss.getAdminStats();
  assert.equal(stats.banned, 1);
  assert.ok(stats.users >= 3);

  // --- unban alone doesn't let them back in: no device, no usable password, the old QR is gone ---
  await boss.setBanned('emp2', false);
  const again = new MessengerClient(new MemoryStorage());
  clients.push(again);
  await again.init();
  await assert.rejects(again.login(url, 'emp2', 'anything-at-all'), /Wrong ID or password/);

  // --- the admin's permission: a new QR code. emp2 chooses a password and is back. ---
  const invite = await boss.newInvite('emp2');
  await again.join(inviteCode(url, invite), 'emp2-new-password');
  again.connect();
  await waitFor(() => again.status === 'online', 'emp2 back online');
  emp2 = again;
  await emp1.sendText('emp2', 'welcome back');
  await waitFor(() => texts(emp2, 'emp1').includes('welcome back'), 'message after rejoining');

  stats = await boss.getAdminStats();
  assert.equal(stats.banned, 0);

  const log = await boss.getAuditLog();
  const actions = log.map((e) => `${e.action}:${e.target}`);
  assert.ok(actions.includes('user.ban:emp2'));
  assert.ok(actions.includes('user.unban:emp2'));
  // Every admin action is by the admin; joining with a QR is logged by the person themselves.
  assert.ok(log.filter((e) => e.action !== 'user.join').every((e) => e.actor === 'boss'));
  assert.ok(actions.includes('user.join:emp2'));
});

test('groups: admin manages members, messages are E2E per member, forged group messages are dropped', async () => {
  const bossClient = clients.find((c) => c.account?.username === 'boss' && c.status === 'online')!;
  assert.ok(bossClient, 'admin client from the first test');
  const a = await newClient('g_alice');
  const b = await newClient('g_bob');
  const outsider = await newClient('g_eve');

  const group = await bossClient.createGroup('Sales team', ['boss', 'g_alice', 'g_bob']);
  assert.deepEqual(group.members, ['boss', 'g_alice', 'g_bob']);
  const key = groupKey(group.id);
  await waitFor(() => !!a.groupOf(key) && !!b.groupOf(key), 'members learn about the group');
  assert.equal(a.chatTitle(key), 'Sales team');
  assert.ok(a.chatKeys().includes(key));
  assert.equal(outsider.groupOf(key), undefined);
  // Member list like WhatsApp: me first, then admins, then the rest A-Z; the header line ends with "You".
  assert.deepEqual(a.groupMembers(key), ['g_alice', 'boss', 'g_bob']);
  assert.equal(a.groupMemberLine(key), 'boss, g_bob, You');

  await a.sendText(key, 'hello team');
  await waitFor(() => texts(b, key).includes('hello team'), 'bob gets the group message');
  await waitFor(() => texts(bossClient, key).includes('hello team'), 'boss gets the group message');
  assert.equal(b.getMessages(key).find((m) => m.text === 'hello team')!.from, 'g_alice');
  assert.equal(a.getMessages(key)[0]!.status, 'sent');
  assert.ok((await srv.queueBodies()).every((x) => !x.includes('hello team')), 'server never sees group text');

  // An outsider who knows the group id cannot inject messages into it.
  await (outsider as unknown as { sendPayload(p: string, x: Payload): Promise<void> }).sendPayload('g_alice', {
    k: 'text',
    id: 'forged',
    text: 'fake group message',
    ts: Date.now(),
    g: group.id,
  });
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(!texts(a, key).includes('fake group message'));

  // --- typing indicator ---
  b.notifyTyping(key);
  await waitFor(() => a.getTyping(key).includes('g_bob'), 'typing shown');

  // --- admin renames + removes bob ---
  await bossClient.updateGroup(group.id, { name: 'Sales', members: ['boss', 'g_alice'] });
  await waitFor(() => !b.groupOf(key), 'bob removed');
  await waitFor(() => a.chatTitle(key) === 'Sales', 'rename seen');
  await assert.rejects(b.sendText(key, 'still here?'), /not in this group/);

  const all = await bossClient.listAllGroups();
  assert.ok(all.some((g) => g.id === group.id));

  await bossClient.deleteGroup(group.id);
  await waitFor(() => !a.groupOf(key), 'group gone');

  const log = await bossClient.getAuditLog();
  assert.ok(log.some((e) => e.action === 'group.create' && e.target === 'Sales team'));
  assert.ok(log.some((e) => e.action === 'group.update' && e.detail.includes('removed: g_bob')));
  assert.ok(log.some((e) => e.action === 'group.delete'));
});

test('edit / delete follow the admin policy; admins may moderate; presence + last seen', async () => {
  const bossClient = clients.find((c) => c.account?.username === 'boss' && c.status === 'online')!;
  const x = await newClient('p_xavi');
  const yStorage = new MemoryStorage();
  let y = await newClient('p_yuki', yStorage);
  const group = await bossClient.createGroup('Ops', ['boss', 'p_xavi', 'p_yuki']);
  const key = groupKey(group.id);
  await waitFor(() => !!x.groupOf(key) && !!y.groupOf(key), 'group known');

  await x.sendText(key, 'first draft');
  await waitFor(() => texts(y, key).includes('first draft'), 'received');
  const id = x.getMessages(key)[0]!.id;

  // Off by default for employees.
  assert.equal(x.canEditDelete, false);
  await assert.rejects(x.editMessage(key, id, 'nope'), /turned off/);

  await bossClient.setPolicy({ allowEditDelete: true });
  await waitFor(() => x.canEditDelete && y.policy.allowEditDelete, 'policy reaches everyone');

  await x.editMessage(key, id, 'final text');
  await waitFor(() => texts(y, key).includes('final text'), 'edit received');
  assert.equal(y.getMessages(key).find((m) => m.id === id)!.edited, true);

  // y cannot delete x's message for everyone (not the author, not an admin).
  await assert.rejects(y.deleteMessage(key, id, true), /own messages/);

  await x.deleteMessage(key, id, true);
  await waitFor(() => texts(y, key).includes('<deleted>'), 'delete received');

  // Admin moderation: boss removes y's message for everyone.
  await y.sendText(key, 'spam');
  await waitFor(() => texts(bossClient, key).includes('spam') && texts(x, key).includes('spam'), 'spam arrives');
  const spamId = bossClient.getMessages(key).find((m) => m.text === 'spam')!.id;
  await bossClient.deleteMessage(key, spamId, true);
  await waitFor(() => !texts(x, key).includes('spam'), 'moderated for x');

  // History is protected by default: employees can't delete for themselves or clear the chat.
  await y.sendText(key, 'keep this');
  await waitFor(() => texts(x, key).includes('keep this'), 'arrives');
  const keepId = x.getMessages(key).find((m) => m.text === 'keep this')!.id;
  assert.equal(x.canClearHistory, false);
  await assert.rejects(x.deleteMessage(key, keepId, false), /turned off deleting/);
  assert.throws(() => x.clearChat(key), /turned off clearing/);
  assert.ok(texts(x, key).includes('keep this'));

  // Once the admin allows it, delete for me only touches my own memory.
  await bossClient.setPolicy({ allowClearHistory: true });
  await waitFor(() => x.canClearHistory, 'clear-history policy reaches x');
  assert.equal(x.policy.allowEditDelete, true); // changing one switch keeps the other
  await x.deleteMessage(key, keepId, false);
  assert.ok(!texts(x, key).includes('keep this'));
  assert.ok(texts(y, key).includes('keep this'));

  await bossClient.setPolicy({ allowEditDelete: false, allowClearHistory: false });
  await waitFor(() => !x.canEditDelete && !x.canClearHistory, 'policy off again');
  assert.ok((await bossClient.getAuditLog()).some((e) => e.detail.includes('clear chat history: on')));

  // --- presence ---
  await x.refreshPresence(['p_yuki']);
  assert.equal(x.getPresence('p_yuki')?.online, true);
  y.dispose();
  await waitFor(() => y.status === 'offline', 'y offline');
  await new Promise((r) => setTimeout(r, 200));
  await x.refreshPresence(['p_yuki']);
  assert.equal(x.getPresence('p_yuki')?.online, false);
  assert.ok((x.getPresence('p_yuki')?.lastSeen ?? 0) > Date.now() - 60_000);
  y = await newClient('p_yuki', yStorage);
});
