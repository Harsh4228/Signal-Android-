import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

// "Send to…" / "Forward to…": my chats first, then everyone else in the company, so a colleague I never chatted
// with can be found by search too; choosing them starts the chat.
let srv: Awaited<ReturnType<typeof startTestServer>>;
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['admin'], openRegistration: true });
});
after(async () => {
  clients.forEach((c) => c.dispose());
  await new Promise((r) => setTimeout(r, 100));
  await srv.close();
});

async function waitFor(fn: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function user(name: string) {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  if (!(await c.init())) await c.register(srv.url, name);
  c.connect();
  await waitFor(() => c.status === 'online', `${name} online`);
  return c;
}

test('send targets: my chats first, then the whole company; search finds anyone; picking one starts the chat', async () => {
  const admin = await user('admin');
  await waitFor(() => admin.isAdmin, 'admin');
  const asha = await user('asha');
  await user('bina');
  await user('chirag');
  await asha.addContact('bina');

  const people = await asha.listDirectory();
  const all = asha.sendTargets(people, '', false);
  assert.equal(all[0], 'bina'); // my chat first
  assert.ok(all.includes('chirag') && all.includes('admin')); // then everyone else
  assert.ok(!all.includes('asha')); // never myself
  assert.deepEqual(asha.sendTargets(people, 'chir', false), ['chirag']); // search finds a colleague I never chatted with

  // Blocked people are left out.
  await asha.setBlocked('chirag', true);
  assert.ok(!asha.sendTargets(people, '', false).includes('chirag'));

  // Picking someone new starts the chat, then it can be sent to.
  await asha.ensureChat('admin');
  assert.ok(asha.chatKeys().includes('admin'));
  await asha.sendText('admin', 'hello from share');
  await waitFor(() => admin.getMessages('asha').some((m) => m.text === 'hello from share'), 'admin got it');
});
