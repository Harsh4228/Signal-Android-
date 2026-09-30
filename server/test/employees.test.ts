import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { MemoryStorage, MessengerClient, MustChangePasswordError, generatePassword } from '@meetme/core';
import { createMeetMeServer } from '../src/app';

// A company server: sign-up closed, "admin" manages employee accounts.
const dir = mkdtempSync(join(tmpdir(), 'meetme-emp-'));
const server = createMeetMeServer({
  dbPath: join(dir, 'test.db'),
  stunUrls: [],
  turnUrls: [],
  trustProxy: false,
  adminUsers: ['admin'],
  openRegistration: false,
});
let url = '';
const clients: MessengerClient[] = [];

before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  clients.forEach((c) => c.dispose());
  await new Promise((r) => setTimeout(r, 100));
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
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

async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}

test('admin creates employee, employee logs in and must set own password', async () => {
  const pub = await (await fresh()).getPublicConfig(url);
  assert.equal(pub.openRegistration, false);

  // Strangers cannot sign up; the admin can create their own account.
  await assert.rejects((await fresh()).register(url, 'stranger'), /Sign-up is closed/);
  const admin = await fresh();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');

  // Admin creates an employee with a temporary password.
  const temp = generatePassword();
  assert.equal(temp.length, 12);
  await admin.createEmployee('ravi', temp);
  await assert.rejects(admin.createEmployee('ravi', temp), /already exists/);
  let list = await admin.listAllUsers();
  assert.deepEqual(
    list.find((u) => u.username === 'ravi'),
    { username: 'ravi', active: false, admin: false, mustChangePassword: true },
  );

  // Can't message someone who hasn't logged in yet.
  await admin.addContact('ravi');
  await assert.rejects(admin.sendText('ravi', 'hi'), /has not logged in yet/);

  // Employee logs in: wrong password, then the first login demands a new password.
  const ravi = await fresh();
  await assert.rejects(ravi.login(url, 'ravi', 'wrong-password'), /Wrong ID or password/);
  await assert.rejects(ravi.login(url, 'ravi', temp), MustChangePasswordError);
  assert.equal(ravi.account, null); // nothing kept after a failed login
  await assert.rejects(ravi.login(url, 'ravi', temp, 'short'), /at least 8/);
  await ravi.login(url, 'ravi', temp, 'ravi-own-secret');
  await online(ravi);

  // The admin's temporary password no longer works.
  await assert.rejects((await fresh()).login(url, 'ravi', temp), /Wrong ID or password/);

  list = await admin.listAllUsers();
  assert.equal(list.find((u) => u.username === 'ravi')!.active, true);

  // Messaging + broadcast work.
  await admin.sendText('ravi', 'welcome');
  await waitFor(() => ravi.getMessages('admin').some((m) => m.text === 'welcome'), 'welcome');
  const r = await admin.broadcast('all hands at 5');
  assert.equal(r.sent, 1);
  await waitFor(() => ravi.getMessages('admin').some((m) => m.broadcast && m.text === 'all hands at 5'), 'broadcast');

  // Employee changes password later.
  await assert.rejects(ravi.changePassword('nope-nope', 'another-one-1'), /Current password is wrong/);
  await ravi.changePassword('ravi-own-secret', 'another-one-1');

  // Logging in on a new phone signs the old phone out (its keys are wiped).
  const raviPhone2 = await fresh();
  await raviPhone2.login(url, 'ravi', 'another-one-1');
  await online(raviPhone2);
  await waitFor(() => ravi.account === null, 'old device logged out');
  await admin.resetSession('ravi');
  await admin.sendText('ravi', 'new phone ok?');
  await waitFor(() => raviPhone2.getMessages('admin').some((m) => m.text === 'new phone ok?'), 'msg to new phone');

  // Forgotten password: admin resets, employee must choose a new one again.
  const temp2 = generatePassword();
  await admin.resetEmployeePassword('ravi', temp2);
  const raviPhone3 = await fresh();
  await assert.rejects(raviPhone3.login(url, 'ravi', temp2), MustChangePasswordError);
  await raviPhone3.login(url, 'ravi', temp2, 'after-reset-99');

  // Non-admins can't manage accounts.
  await assert.rejects(raviPhone3.createEmployee('x_y', 'password123'), /admin only/);

  // Admin removes the employee: their device is signed out.
  await online(raviPhone3);
  await admin.removeEmployee('ravi');
  await waitFor(() => raviPhone3.account === null, 'removed employee logged out');
  await assert.rejects((await fresh()).login(url, 'ravi', 'after-reset-99'), /Wrong ID or password/);
});
