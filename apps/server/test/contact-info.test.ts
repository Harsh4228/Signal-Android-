import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, inviteCode, parseInviteCode, profileLine, toBase64 } from '@meetme/core';
import { startTestServer } from './harness';

// The admin makes the whole profile (name, mobile, email, photo, departments) and gets a one-time QR invite;
// the person scans it and only chooses a password. Profiles are locked: only the admin changes them.
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);

test('admin creates the full profile + QR invite; the person joins by choosing a password; profile is locked', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  await admin.addDepartment('Sales');

  // Admin fills in everything.
  const invite = await admin.inviteEmployee({
    username: 'ravi.k',
    name: '  Ravi   Kumar ',
    phone: '+91 98765 43210',
    email: 'Ravi@Company.com',
    departments: ['Sales'],
    photo: { mime: 'image/png', data: toBase64(PNG) },
  });
  assert.equal(invite.username, 'ravi.k');
  assert.ok(invite.expires > Date.now() + 6 * 24 * 3600_000);
  const code = inviteCode(url, invite);
  assert.deepEqual(parseInviteCode(code), { serverUrl: url, username: 'ravi.k', token: invite.token });
  assert.equal(parseInviteCode('https://example.com'), null);
  await assert.rejects(admin.inviteEmployee({ username: 'x1y', name: 'X', phone: 'call me' }), /Mobile number/);
  await assert.rejects(admin.inviteEmployee({ username: 'x2y', name: 'X', email: 'nope' }), /email address/);

  const listed = (await admin.listAllUsers()).find((u) => u.username === 'ravi.k')!;
  assert.equal(listed.name, 'Ravi Kumar');
  assert.equal(listed.email, 'ravi@company.com');
  assert.ok(listed.inviteExpires);
  assert.ok(listed.avatar);

  // Ravi scans the QR: chooses a password, and he's in.
  const ravi = await device();
  await assert.rejects(ravi.join(code, 'short'), /at least 8/);
  await assert.rejects(ravi.join(code.replace(invite.token, 'x'.repeat(43)), 'ravi-own-password'), /not valid any more/);
  await ravi.join(code, 'ravi-own-password');
  assert.equal(ravi.account!.username, 'ravi.k');
  await online(ravi);
  assert.deepEqual(await ravi.getMyContactInfo(), { name: 'Ravi Kumar', phone: '+91 98765 43210', email: 'ravi@company.com' });
  assert.equal((await admin.listAllUsers()).find((u) => u.username === 'ravi.k')!.inviteExpires, null);

  // The invite works once.
  await assert.rejects((await device()).join(code, 'someone-else-pw'), /not valid any more/);

  // His own password now works for a normal login too.
  // (A second device replaces the first, like before.)
  const raviPc = await device();
  await raviPc.login(url, 'ravi.k', 'ravi-own-password');
  await online(raviPc);
  await waitFor(() => ravi.account === null, 'old device signed out');

  // Locked: he can't change his name, photo, mobile or email.
  await assert.rejects(raviPc.setMyContactInfo('123456789', ''), /Only your admin/);
  await assert.rejects(raviPc.setMyAvatar({ mime: 'image/png', data: PNG }), /Only your admin/);
  await assert.rejects(raviPc.setEmployeeProfile('ravi.k', { name: 'Boss' }), /admin only/);

  // Colleagues see the full name + directory line.
  const meena = await device();
  const inv2 = await admin.inviteEmployee({ username: 'meena', name: 'Meena S' });
  await meena.join(inviteCode(url, inv2), 'meena-own-password');
  await online(meena);
  meena.profileOf('ravi.k');
  await waitFor(() => !!meena.profileOf('ravi.k'), 'profile loaded');
  assert.equal(meena.chatTitle('ravi.k'), 'Ravi Kumar');
  assert.equal(profileLine(meena.profileOf('ravi.k')), 'Sales · +91 98765 43210 · ravi@company.com');

  // Only the admin changes the profile.
  await admin.setEmployeeProfile('ravi.k', { name: 'Ravi K. Sharma', phone: '' });
  await admin.setEmployeeAvatar('ravi.k', null);
  const after = (await admin.listAllUsers()).find((u) => u.username === 'ravi.k')!;
  assert.equal(after.name, 'Ravi K. Sharma');
  assert.equal(after.phone, '');
  assert.equal(after.email, 'ravi@company.com');
  assert.equal(after.avatar, null);

  // A new QR moves him to a new phone (the old device is signed out).
  const inv3 = await admin.newInvite('ravi.k');
  const raviPhone = await device();
  await raviPhone.join(inviteCode(url, inv3), 'ravi-new-password');
  await online(raviPhone);
  await waitFor(() => raviPc.account === null, 'pc signed out');

  // Banned people can't use an invite.
  await admin.setBanned('meena', true);
  const inv4 = await admin.newInvite('meena');
  await assert.rejects((await device()).join(inviteCode(url, inv4), 'meena-pw-again'), /suspended/);

  const actions = (await admin.getAuditLog()).map((e) => e.action);
  for (const a of ['user.create', 'user.join', 'user.profile', 'user.invite']) assert.ok(actions.includes(a), a);
});
