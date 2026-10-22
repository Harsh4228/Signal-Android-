import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

// On a company server (with admins) users can't delete their own account; only an admin removes it.
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

async function fresh() {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  return c;
}

test('employees and admins cannot delete their own account; the admin can remove an employee', async () => {
  const admin = await fresh();
  await admin.register(srv.url, 'admin');
  admin.connect();
  await waitFor(() => admin.status === 'online' && admin.isAdmin, 'admin online');

  await admin.createEmployee('ravi', 'temp-password-1');
  const ravi = await fresh();
  await ravi.login(srv.url, 'ravi', 'temp-password-1', 'ravi-own-secret');
  ravi.connect();
  await waitFor(() => ravi.status === 'online', 'ravi online');

  assert.equal(ravi.canDeleteOwnAccount, false);
  await assert.rejects(ravi.deleteAccount(), /Only an admin can delete accounts/);
  assert.ok(ravi.account, 'nothing was wiped on this device');

  // A modified app calling the server directly is refused too, and keeps its keys.
  const raw = ravi as unknown as { http(m: string, p: string): Promise<unknown> };
  await assert.rejects(raw.http('DELETE', '/v1/account'), /Only an admin can delete accounts/);
  assert.ok((await admin.listAllUsers()).some((u) => u.username === 'ravi'));

  await assert.rejects(admin.deleteAccount(), /Only an admin can delete accounts/);

  // The admin removes the account from the admin panel; ravi's device is signed out.
  await admin.removeEmployee('ravi');
  await waitFor(() => ravi.account === null, 'ravi signed out');
});

test('on an open server without admins people can still delete their own account', async () => {
  const open = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: true });
  try {
    const c = new MessengerClient(new MemoryStorage());
    await c.init();
    await c.register(open.url, 'solo');
    c.connect();
    await waitFor(() => c.status === 'online', 'online');
    assert.equal(c.canDeleteOwnAccount, true);
    await c.deleteAccount();
    assert.equal(c.account, null);
    c.dispose();
  } finally {
    await open.close();
  }
});
