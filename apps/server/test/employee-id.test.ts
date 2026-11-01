import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

// Employee IDs: the admin sets them (any letters, digits, symbols), they are unique in the company, editable,
// and colleagues see them on the profile.
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

async function waitFor(fn: () => boolean, what: string, ms = 5000) {
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

const idOf = async (admin: MessengerClient, u: string) => (await admin.listAllUsers()).find((x) => x.username === u)?.employeeId;

test('employee ID: any characters, unique in the company (ignoring case), editable, shown on the profile', async () => {
  const admin = await user('admin');
  await waitFor(() => admin.isAdmin, 'admin');
  const asha = await user('asha');

  // Capital and small letters, digits, symbols and spaces are all kept as typed.
  await admin.inviteEmployee({ username: 'ravi', name: 'Ravi Kumar', employeeId: '  Mfg/2024#17 Ä-b ' });
  assert.equal(await idOf(admin, 'ravi'), 'Mfg/2024#17 Ä-b');

  // Unique in the company, whatever the capitals.
  await assert.rejects(admin.inviteEmployee({ username: 'sunil', name: 'Sunil', employeeId: 'MFG/2024#17 ä-B' }), /already used by Ravi Kumar/);
  await admin.inviteEmployee({ username: 'sunil', name: 'Sunil', employeeId: 'EMP-0002' });
  await assert.rejects(admin.setEmployeeProfile('ravi', { employeeId: 'emp-0002' }), /already used by Sunil/);

  // Editable: keeping your own ID is fine, a new one replaces it, '' removes it.
  await admin.setEmployeeProfile('ravi', { employeeId: 'Mfg/2024#17 Ä-b', name: 'Ravi K' });
  await admin.setEmployeeProfile('sunil', { employeeId: 'emp-0002' });
  assert.equal(await idOf(admin, 'sunil'), 'emp-0002');
  await admin.setEmployeeProfile('asha', { employeeId: 'HR_01!' });
  assert.equal(await idOf(admin, 'asha'), 'HR_01!');

  // Too long or with control characters: refused.
  await assert.rejects(admin.setEmployeeProfile('asha', { employeeId: 'x'.repeat(41) }), /at most 40/);
  await assert.rejects(admin.setEmployeeProfile('asha', { employeeId: 'a\u0007b' }), /at most 40/);

  // Colleagues see it on the profile.
  admin.profileOf('asha');
  await waitFor(() => admin.profileOf('asha')?.employeeId === 'HR_01!', 'admin sees the ID on the profile');
  await admin.setEmployeeProfile('asha', { employeeId: '' });
  assert.equal(await idOf(admin, 'asha'), '');
  // Employees can't set it themselves (only the admin edits profiles).
  await assert.rejects(asha.setEmployeeProfile('asha', { employeeId: 'MINE' }), /admin/i);
});
