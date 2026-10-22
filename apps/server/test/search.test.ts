import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

// "Start a chat" suggestions: prefix search over people you can message.
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

async function fresh() {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  return c;
}

test('username search matches by prefix and skips you, pending and banned users', async () => {
  const admin = await fresh();
  await admin.register(url, 'admin');

  for (const name of ['deep', 'dina', 'dev.ops', 'ravi']) {
    await admin.createEmployee(name, 'temp-password-1');
    await (await fresh()).login(url, name, 'temp-password-1', `${name}-own-secret`);
  }
  await admin.createEmployee('dhruv', 'temp-password-1'); // never logged in
  await admin.setBanned('dina', true);

  assert.deepEqual(await admin.searchUsers('d'), ['deep', 'dev.ops']);
  assert.deepEqual(await admin.searchUsers('DE'), ['deep', 'dev.ops']);
  assert.deepEqual(await admin.searchUsers('dee'), ['deep']);
  assert.deepEqual(await admin.searchUsers('x'), []);
  assert.deepEqual(await admin.searchUsers(''), []);
  assert.deepEqual(await admin.searchUsers('a'), []); // only "admin", which is you

  // Employees can search too.
  const ravi = await fresh();
  await ravi.login(url, 'ravi', 'ravi-own-secret');
  assert.deepEqual(await ravi.searchUsers('a'), ['admin']);
});
