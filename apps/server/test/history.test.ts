import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

// "Employees may clear their chat history" (admin setting, off by default on a server with admins).
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

test('with history protected, employees cannot make messages disappear; admins still can', async () => {
  const admin = await fresh();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  const emp: MessengerClient[] = [];
  for (const n of ['asha', 'bina']) {
    await admin.createEmployee(n, 'temp-password-1');
    const c = await fresh();
    await c.login(url, n, 'temp-password-1', `${n}-own-secret`);
    emp.push(await online(c));
  }
  const [asha, bina] = emp as [MessengerClient, MessengerClient];
  assert.equal(asha.policy.allowClearHistory, false);
  assert.equal(admin.canClearHistory, true);

  // An employee can't turn on disappearing messages...
  await asha.addContact('bina');
  await assert.rejects(asha.setDisappearingTimer('bina', 30), /turned off disappearing/);
  await asha.setDisappearingTimer('bina', 0); // turning it off is always allowed

  // ...and a modified app that tries anyway is ignored by the other side.
  await (asha as unknown as { sendPayload(p: string, x: object): Promise<void> }).sendPayload('bina', { k: 'timer', expire: 30 });
  await asha.sendText('bina', 'stays');
  await waitFor(() => bina.getMessages('asha').some((m) => m.text === 'stays'), 'bina got it');
  assert.equal(bina.getDisappearingTimer('asha'), 0);
  assert.equal(bina.getMessages('asha').find((m) => m.text === 'stays')!.expiresAt, undefined);

  // An admin may still use them in their own chats, and the employee's side follows.
  await admin.addContact('asha');
  await admin.sendText('asha', 'hi');
  await waitFor(() => asha.getMessages('admin').length > 0, 'asha got hi');
  await admin.setDisappearingTimer('asha', 300);
  await waitFor(() => asha.getDisappearingTimer('admin') === 300, 'timer reached asha');
  await admin.sendText('asha', 'vanishes');
  await waitFor(() => !!asha.getMessages('admin').find((m) => m.text === 'vanishes')?.expiresAt, 'expiring message');

  // Allowing it lets employees use the timer again.
  await admin.setPolicy({ allowClearHistory: true });
  await waitFor(() => asha.canClearHistory, 'policy reached asha');
  await asha.setDisappearingTimer('bina', 30);
  await waitFor(() => bina.getDisappearingTimer('asha') === 30, 'timer reached bina');
});

test('on a server without admins, users keep control of their own history', async () => {
  const open = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: true });
  try {
    const c = new MessengerClient(new MemoryStorage());
    clients.push(c);
    await c.init();
    await c.register(open.url, 'solo');
    c.connect();
    await waitFor(() => c.status === 'online', 'online');
    assert.equal(c.canClearHistory, true);
    c.dispose();
  } finally {
    await open.close();
  }
});
