import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, inviteCode } from '@meetme/core';
import { startTestServer } from './harness';

// "New chat" shows everyone you can message, with their department, without searching first.
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

async function device() {
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

test('the directory lists every colleague who can be messaged, with departments and names', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  await admin.addDepartment('Sales');
  await admin.addDepartment('Support');

  const join = async (username: string, name: string, departments: string[]) => {
    const invite = await admin.inviteEmployee({ username, name, departments });
    const c = await device();
    await c.join(inviteCode(url, invite), `${username}-password`);
    return online(c);
  };
  const zara = await join('zara', 'Zara Shah', ['Sales']);
  await join('amit', 'Amit Rao', ['Support', 'Sales']);
  await join('gone', 'Gone User', []);
  await admin.inviteEmployee({ username: 'later', name: 'Not Joined', departments: ['Sales'] }); // never logs in
  await admin.setBanned('gone', true);

  const list = await zara.listDirectory();
  // Not me, not the banned one, not someone who never logged in (they can't receive messages yet). Sorted by name.
  assert.deepEqual(
    list.map((u) => u.username),
    ['admin', 'amit'],
  );
  const amit = list.find((u) => u.username === 'amit')!;
  assert.equal(amit.name, 'Amit Rao');
  assert.deepEqual([...amit.departments].sort(), ['Sales', 'Support']);
  // Names are known straight away, without opening each profile.
  assert.equal(zara.displayName('amit'), 'Amit Rao');
});
