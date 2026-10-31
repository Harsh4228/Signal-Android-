import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, MustChangePasswordError, generatePassword } from '@meetme/core';
import { startTestServer } from './harness';

// A company server: sign-up closed, "admin" manages employee accounts.
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
  const { createdAt, inviteExpires, ...pending } = list.find((u) => u.username === 'ravi')!;
  assert.ok(createdAt > 0);
  assert.ok(inviteExpires && inviteExpires > Date.now()); // every new user also gets a QR invite
  assert.deepEqual(pending, {
    username: 'ravi',
    active: false,
    admin: false,
    mustChangePassword: true,
    banned: false,
    online: false,
    lastSeen: null,
    departments: [],
    canShare: false,
    avatar: null,
    phone: '',
    email: '',
    name: '',
    birthday: '',
  });

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

test('IDs may have capitals, spaces and symbols; birth dates', async () => {
  const s2 = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['boss'], openRegistration: false });
  const mine: MessengerClient[] = [];
  try {
    const boss = await fresh();
    mine.push(boss);
    await boss.register(s2.url, 'boss');
    await online(boss);
    await waitFor(() => boss.isAdmin, 'admin flag');

    // Typed with capitals and extra spaces: stored lowercase with single spaces.
    await boss.createEmployee('  Ravi   Kumar@2 ', 'temp-password-1');
    await assert.rejects(boss.createEmployee('ravi-kumar', 'temp-password-1'), /ID: 3-32/);
    await assert.rejects(boss.createEmployee('a/b', 'temp-password-1'), /ID: 3-32/);
    const ravi = await fresh();
    mine.push(ravi);
    await ravi.login(s2.url, 'RAVI KUMAR@2', 'temp-password-1', 'ravi-own-secret');
    assert.equal(ravi.account!.username, 'ravi kumar@2');
    await online(ravi);

    // Keys, profile, photo and sealed sending all go through the %-encoded ID.
    await boss.setEmployeeProfile('ravi kumar@2', { name: 'Ravi Kumar', birthday: '1995-03-14' });
    await assert.rejects(boss.setEmployeeProfile('ravi kumar@2', { birthday: '2999-01-01' }), /Birth date/);
    boss.profileOf('ravi kumar@2');
    await waitFor(() => boss.profileOf('ravi kumar@2')?.birthday === '1995-03-14', 'birthday on the profile');
    await boss.addContact('ravi kumar@2');
    await boss.sendText('ravi kumar@2', 'hello with spaces');
    await waitFor(() => ravi.getMessages('boss').some((m) => m.text === 'hello with spaces'), 'message to spaced ID');
    await ravi.sendText('boss', 'reply');
    await waitFor(() => boss.getMessages('ravi kumar@2').some((m) => m.text === 'reply'), 'reply from spaced ID');

    // Their own birth date, on their profile.
    await ravi.setPrivacy({ birthday: '1995-03-15' });
    assert.equal(ravi.birthday, '1995-03-15');
    assert.equal((await boss.listAllUsers()).find((u) => u.username === 'ravi kumar@2')!.birthday, '1995-03-15');
  } finally {
    mine.forEach((c) => c.dispose());
    await s2.close();
  }
});

test('company profile: admins write information sections and a logo; everyone reads them', async () => {
  const s3 = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['chief'], openRegistration: true });
  const mine: MessengerClient[] = [];
  try {
    const chief = await fresh();
    mine.push(chief);
    await chief.register(s3.url, 'chief');
    await online(chief);
    await waitFor(() => chief.isAdmin, 'admin flag');
    await chief.setCompanyProfile({ items: [{ id: '', title: 'Office address', text: 'MG Road, Pune' }] });
    await assert.rejects(chief.setCompanyProfile({ items: [{ id: '', title: '', text: 'x' }] }), /needs a title/);
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    await chief.setCompanyLogo({ mime: 'image/png', data: png });
    assert.ok(chief.companyLogo.startsWith('data:image/png;base64,'));

    const worker = await fresh();
    mine.push(worker);
    await worker.register(s3.url, 'worker');
    await online(worker);
    await waitFor(() => worker.companyProfile?.items[0]?.title === 'Office address' && !!worker.companyLogo, 'company profile on the worker');
    await assert.rejects(worker.setCompanyProfile({ items: [] }), /admin only/);

    // A PDF attached to a section: everyone can open it; files no section uses are deleted.
    const pdf = new TextEncoder().encode('%PDF-1.4 test');
    const file = await chief.uploadCompanyFile({ name: 'Rules.pdf', mime: 'application/pdf', data: pdf });
    await assert.rejects(chief.uploadCompanyFile({ name: 'x.exe', mime: 'application/x-msdownload', data: pdf }), /Attach a PDF/);
    await chief.setCompanyProfile({ items: [{ id: '', title: 'Rules', text: 'Call +91 98765 43210', file }] });
    const got = await worker.companyFile(file.id);
    assert.equal(got.name, 'Rules.pdf');
    assert.deepEqual([...got.data], [...pdf]);
    await chief.setCompanyProfile({ items: [] });
    await assert.rejects(worker.companyFile(file.id), /not found/);
  } finally {
    mine.forEach((c) => c.dispose());
    await s3.close();
  }
});
