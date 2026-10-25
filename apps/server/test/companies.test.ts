import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, inviteCode, makeUsername } from '@meetme/core';
import { startTestServer } from './harness';

// A company server: the owner ("boss", in ADMIN_USERS) sets it up and is the super admin.
let srv: Awaited<ReturnType<typeof startTestServer>>;
let url = '';
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['boss'], openRegistration: false });
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

async function fresh(storage = new MemoryStorage()) {
  const c = new MessengerClient(storage);
  clients.push(c);
  await c.init();
  return c;
}

async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}

/** Someone scans their QR invite on a new phone and chooses a password. */
async function joinWith(invite: { username: string; token: string }, password: string) {
  const c = await fresh();
  await c.join(inviteCode(url, invite), password);
  return online(c);
}

test('companies: setup, separate people, several admins, moving someone out and back', async () => {
  assert.equal((await (await fresh()).getPublicConfig(url)).needsSetup, true);

  // Only the owner may set the server up, and only once. Their login password works afterwards.
  await assert.rejects(
    (await fresh()).setupServer(url, { companyCode: 'acme', companyName: 'Acme', id: 'mallory', password: 'password-123' }),
    /Only the server owner/,
  );
  const boss = await fresh();
  await boss.setupServer(url, { companyCode: 'acme', companyName: 'Acme Ltd', id: 'boss', password: 'boss-password-1' });
  assert.equal(boss.account!.username, 'boss-acme');
  await online(boss);
  await waitFor(() => boss.isSuper && boss.isAdmin && boss.company?.name === 'Acme Ltd', 'boss roles');
  assert.equal((await (await fresh()).getPublicConfig(url)).needsSetup, false);
  await assert.rejects(
    (await fresh()).setupServer(url, { companyCode: 'acme', companyName: 'Again', id: 'boss', password: 'password-123' }),
    /already used/, // later requests are new companies waiting for approval (see below)
  );
  // The owner can sign in again with company + ID + password (e.g. on a new phone).
  const bossPhone2 = await fresh();
  await bossPhone2.login(url, makeUsername('boss', 'acme'), 'boss-password-1');
  bossPhone2.dispose();
  await boss.login(url, 'boss-acme', 'boss-password-1');
  await online(boss);
  await waitFor(() => boss.isSuper, 'boss back');

  // A second company with its own first admin.
  await assert.rejects(boss.createCompany({ code: 'acme', name: 'Again', adminId: 'x_y' }), /already used/);
  const { invite: betaInvite } = await boss.createCompany({ code: 'beta', name: 'Beta Corp', adminId: 'boss', adminName: 'Beta Boss' });
  assert.equal(betaInvite.username, 'boss-beta'); // the same ID can exist in two companies
  const betaBoss = await joinWith(betaInvite, 'beta-boss-pw-1');
  await waitFor(() => betaBoss.isAdmin && !betaBoss.isSuper && betaBoss.company?.code === 'beta', 'beta admin');
  await assert.rejects(betaBoss.listCompanies(), /super admin only/);

  // Each admin adds people to their own company.
  const ravi = await joinWith(await boss.inviteEmployee({ username: 'ravi', name: 'Ravi K' }), 'ravi-password-1');
  assert.equal(ravi.account!.username, 'ravi-acme');
  const bravo = await joinWith(await betaBoss.inviteEmployee({ username: 'ravi', name: 'Other Ravi' }), 'ravi-beta-pw-1');
  assert.equal(bravo.account!.username, 'ravi-beta');
  assert.equal(ravi.displayName('ravi-acme'), 'ravi'); // until the profile has loaded, the ID part is shown

  // Each company only sees its own people.
  assert.deepEqual((await boss.listAllUsers()).map((u) => u.username).sort(), ['boss-acme', 'ravi-acme']);
  assert.deepEqual((await betaBoss.listAllUsers()).map((u) => u.username).sort(), ['boss-beta', 'ravi-beta']);
  assert.deepEqual(await ravi.searchUsers('r'), []);
  assert.deepEqual(await ravi.searchUsers('b'), ['boss-acme']);
  await assert.rejects(bravo.addContact('ravi-acme'), /not found/);
  await ravi.addContact('boss-acme');
  await ravi.sendText('boss-acme', 'hi boss');
  await waitFor(() => boss.getMessages('ravi-acme').some((m) => m.text === 'hi boss'), 'same-company message');
  await assert.rejects(betaBoss.setBanned('ravi-acme', true), /not found/);

  // A second admin in acme; the last admin can't be removed.
  await boss.setUserAdmin('ravi-acme', true);
  await waitFor(() => ravi.isAdmin, 'ravi became admin');
  assert.ok((await ravi.listAllUsers()).find((u) => u.username === 'ravi-acme')!.admin);
  await ravi.setUserAdmin('ravi-acme', false);
  await waitFor(() => !ravi.isAdmin, 'ravi no longer admin');
  await assert.rejects(boss.setUserAdmin('boss-acme', false), /at least one admin/);

  // Super admin moves ravi to beta (as "ravi.k", since beta already has a ravi).
  const raviStorage = new MemoryStorage();
  const raviApp = await fresh(raviStorage);
  await raviApp.login(url, 'ravi-acme', 'ravi-password-1');
  await online(raviApp);
  await raviApp.addContact('boss-acme');
  await assert.rejects(boss.transferUser('ravi-acme', 'beta'), /already used in beta/);
  const moved = await boss.transferUser('ravi-acme', 'beta', 'ravi.k');
  assert.equal(moved.username, 'ravi.k-beta');
  assert.equal(moved.returning, false);
  await waitFor(() => raviApp.moved, 'app sees the move');
  assert.ok(raviApp.account, 'nothing is wiped on the device');
  assert.ok((await boss.listAllUsers()).find((u) => u.username === 'ravi-acme')!.moved);

  // The app joins beta with the same keys: its contacts stay, and it now talks to beta.
  const identity = raviApp.account!.identity.pub;
  await raviApp.join(inviteCode(url, moved.invite), 'ravi-new-pw-11');
  assert.equal(raviApp.account!.username, 'ravi.k-beta');
  assert.deepEqual(raviApp.account!.identity.pub, identity);
  assert.ok(raviApp.contacts.includes('boss-acme'), 'old contacts kept');
  await online(raviApp);
  await raviApp.addContact('boss-beta');
  await raviApp.sendText('boss-beta', 'hello beta');
  await waitFor(() => betaBoss.getMessages('ravi.k-beta').some((m) => m.text === 'hello beta'), 'message in new company');

  // Moved back: the same acme account opens again.
  const back = await boss.transferUser('ravi.k-beta', 'acme', 'ravi');
  assert.equal(back.username, 'ravi-acme');
  assert.equal(back.returning, true);
  await waitFor(() => raviApp.moved, 'app sees the second move');
  await raviApp.join(inviteCode(url, back.invite), 'ravi-back-pw-11');
  await online(raviApp);
  assert.equal(raviApp.account!.username, 'ravi-acme');
  assert.ok(!(await boss.listAllUsers()).find((u) => u.username === 'ravi-acme')!.moved);
  await raviApp.sendText('boss-acme', 'back again');
  await waitFor(() => boss.getMessages('ravi-acme').some((m) => m.text === 'back again'), 'message after coming back');

  const companies = await boss.listCompanies();
  assert.deepEqual(
    companies.map((c) => [c.code, c.name, c.users]),
    [
      ['acme', 'Acme Ltd', 2],
      ['beta', 'Beta Corp', 2],
    ],
  );
});

test('a company asked for in the app waits for the super admin; the web page signs in with the password', async () => {
  // (the server was set up by "boss-acme" in the test above)
  const owner = await fresh();
  await owner.setupServer(url, { companyCode: 'gamma', companyName: 'Gamma Traders', id: 'gita', password: 'gita-password-1' });
  assert.equal(owner.account!.username, 'gita-gamma');
  owner.connect();
  await waitFor(() => owner.pending, 'waiting for approval');
  assert.equal(owner.status, 'offline');
  await assert.rejects((await fresh()).login(url, 'gita-gamma', 'gita-password-1'), /waiting for approval/);
  await assert.rejects(
    (await fresh()).setupServer(url, { companyCode: 'gamma', companyName: 'Copy', id: 'x_y', password: 'password-123' }),
    /already used/,
  );

  // The server owner's web page: company code + ID + password.
  const page = await fetch(`${url}/super`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  const bad = await fetch(`${url}/v1/super/session`, { method: 'POST', body: JSON.stringify({ username: 'gita-gamma', password: 'gita-password-1' }) });
  assert.equal(bad.status, 401, 'only the super admin may sign in');
  const login = await fetch(`${url}/v1/super/session`, { method: 'POST', body: JSON.stringify({ username: 'boss-acme', password: 'boss-password-1' }) });
  assert.equal(login.status, 200);
  const { token } = (await login.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}` };
  const list = (await (await fetch(`${url}/v1/super/companies`, { headers: auth })).json()) as { companies: { code: string; status: string }[] };
  assert.deepEqual(list.companies[0], { ...list.companies[0], code: 'gamma', status: 'pending' }); // waiting ones first
  assert.equal((await fetch(`${url}/v1/admin/users`, { headers: auth })).status, 401, 'the web sign-in only opens the super admin pages');

  // Approve: the app connects by itself (it checks back every minute; reconnect now to keep the test short).
  assert.equal((await fetch(`${url}/v1/super/companies/gamma/status`, { method: 'PUT', headers: auth, body: JSON.stringify({ status: 'active' }) })).status, 204);
  owner.disconnect();
  await online(owner);
  await waitFor(() => owner.isAdmin && owner.company?.name === 'Gamma Traders' && !owner.pending, 'approved');
  const created = (await (await fetch(`${url}/v1/super/companies`, { method: 'POST', headers: auth, body: JSON.stringify({ code: 'delta', name: 'Delta', adminId: 'dev' }) })).json()) as { code: string; qrSvg: string };
  assert.match(created.code, /^cellmate:\/\/join\?/);
  assert.match(created.qrSvg, /^<svg/);

  // Suspend cuts everyone off without deleting anything; signing out ends the web session.
  assert.equal((await fetch(`${url}/v1/super/companies/gamma/status`, { method: 'PUT', headers: auth, body: JSON.stringify({ status: 'suspended' }) })).status, 204);
  await waitFor(() => owner.status !== 'online', 'suspended company disconnected');
  assert.ok(owner.account);
  assert.equal((await fetch(`${url}/v1/super/session`, { method: 'DELETE', headers: auth })).status, 204);
  assert.equal((await fetch(`${url}/v1/super/companies`, { headers: auth })).status, 401);
});
