import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, departmentsOf } from '@meetme/core';
import { startTestServer } from './harness';

// Departments: a list the admin manages; each user can be in several. Used to filter users and to
// address announcements.
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

test('users in several departments; announcements reach anyone in a chosen department, once', async () => {
  const admin = await fresh();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');

  // The department list: add, no duplicates (any case), sorted A-Z.
  assert.deepEqual(await admin.listDepartments(), []);
  await admin.addDepartment('Sales');
  assert.deepEqual(await admin.addDepartment('  Accounts '), ['Accounts', 'Sales']);
  await assert.rejects(admin.addDepartment('sales'), /already exists/);
  await assert.rejects(admin.addDepartment('   '), /1-40 characters/);
  await admin.addDepartment('Support');
  // Every department a user gets must come from the list.
  await assert.rejects(admin.createEmployee('zed', 'temp-password-1', ['Sales', 'Marketing']), /Unknown department "Marketing"/);
  await assert.rejects(admin.createEmployee('zed', 'temp-password-1', 'Sales' as never), /list of names/);

  const people: Record<string, MessengerClient> = {};
  for (const [name, depts] of [
    ['asha', ['Sales']],
    ['bina', ['support', 'Sales', 'sales']], // matched to the list, once each, A-Z
    ['chirag', ['Accounts']],
    ['dev', []],
  ] as const) {
    await admin.createEmployee(name, 'temp-password-1', [...depts]);
    const c = await fresh();
    await c.login(url, name, 'temp-password-1', `${name}-own-secret`);
    people[name] = await online(c);
  }

  let users = await admin.listAllUsers();
  const deptsOf = (u: string) => users.find((x) => x.username === u)!.departments;
  assert.deepEqual(deptsOf('asha'), ['Sales']);
  assert.deepEqual(deptsOf('bina'), ['Sales', 'Support']);
  assert.deepEqual(deptsOf('chirag'), ['Accounts']);
  assert.deepEqual(deptsOf('dev'), []);
  assert.deepEqual(departmentsOf(users), ['Accounts', 'Sales', 'Support']);

  // Change someone's departments, clear someone's, reject unknown names; only admins may change them.
  await admin.setDepartments('dev', ['Support', 'Accounts']);
  await admin.setDepartments('chirag', []);
  await assert.rejects(admin.setDepartments('asha', ['Nowhere']), /Unknown department/);
  await assert.rejects(people.asha!.setDepartments('bina', ['Sales']), /admin only/);
  await assert.rejects(people.asha!.listDepartments(), /admin only/);
  users = await admin.listAllUsers();
  assert.deepEqual(deptsOf('dev'), ['Accounts', 'Support']);
  assert.deepEqual(deptsOf('chirag'), []);
  assert.ok((await admin.getAuditLog()).some((e) => e.action === 'user.department' && e.target === 'dev'));

  // Bina is in Sales AND Support: she counts for both, but is listed (and messaged) only once.
  assert.deepEqual((await admin.listActiveRecipients(['Sales'])).sort(), ['asha', 'bina']);
  assert.deepEqual((await admin.listActiveRecipients(['Support'])).sort(), ['bina', 'dev']);
  assert.deepEqual((await admin.listActiveRecipients(['Sales', 'Support'])).sort(), ['asha', 'bina', 'dev']);
  assert.deepEqual((await admin.listActiveRecipients()).sort(), ['asha', 'bina', 'chirag', 'dev']);

  const r = await admin.broadcast('sales or support: meet at 4', undefined, { departments: ['Sales', 'Support'] });
  assert.deepEqual(r, { sent: 3, failed: [] });
  for (const n of ['asha', 'bina', 'dev']) {
    await waitFor(() => people[n]!.getMessages('admin').some((m) => m.broadcast && m.text === 'sales or support: meet at 4'), n);
  }
  assert.equal(people.bina!.getMessages('admin').filter((m) => m.text === 'sales or support: meet at 4').length, 1);
  // A message everyone gets afterwards proves Chirag's queue is drained, so the department one never came.
  await admin.broadcast('all hands');
  await waitFor(() => people.chirag!.getMessages('admin').some((m) => m.text === 'all hands'), 'chirag');
  assert.ok(!people.chirag!.getMessages('admin').some((m) => m.text === 'sales or support: meet at 4'));

  await assert.rejects(admin.broadcast('hello?', undefined, { departments: ['Nobody'] }), /Nobody in those departments/);
});

test('renaming a department updates everyone in it; deleting removes it but keeps their other ones', async () => {
  const admin = clients[0]!; // the admin from the test above
  await admin.renameDepartment('Sales', 'Sales & Marketing');
  await assert.rejects(admin.renameDepartment('Accounts', 'support'), /already exists/);
  await assert.rejects(admin.renameDepartment('Nope', 'X'), /not found/);
  let users = await admin.listAllUsers();
  const deptsOf = (u: string) => users.find((x) => x.username === u)!.departments;
  assert.deepEqual(deptsOf('asha'), ['Sales & Marketing']);
  assert.deepEqual(deptsOf('bina'), ['Sales & Marketing', 'Support']);
  assert.deepEqual(await admin.listDepartments(), ['Accounts', 'Sales & Marketing', 'Support']);

  assert.deepEqual(await admin.deleteDepartment('Support'), ['Accounts', 'Sales & Marketing']);
  users = await admin.listAllUsers();
  assert.deepEqual(deptsOf('bina'), ['Sales & Marketing']);
  assert.deepEqual(deptsOf('dev'), ['Accounts']);

  const actions = (await admin.getAuditLog()).map((e) => e.action);
  for (const a of ['department.create', 'department.rename', 'department.delete']) assert.ok(actions.includes(a), a);
});
