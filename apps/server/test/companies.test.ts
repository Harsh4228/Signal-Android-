import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, MustChangePasswordError, inviteCode, makeUsername } from '@meetme/core';
import { startTestServer } from './harness';

// A company server. The owner ("owner", no company) runs it from the /super web page.
let srv: Awaited<ReturnType<typeof startTestServer>>;
let url = '';
let owner: Record<string, string> = {};
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: false });
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

/** The owner's web page API (Bearer token from the web sign-in). */
async function web<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = owner): Promise<T> {
  const res = await fetch(`${url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** An app's own API credentials (its device secret), as the apps send them. */
const deviceAuth = (c: MessengerClient) => ({
  authorization: `Basic ${Buffer.from(`${c.account!.username}:${c.account!.password}`).toString('base64')}`,
});

type Invite = { username: string; token: string; expires: number };

test('owner sets up the server on the web page and creates companies; admins manage their own people', async () => {
  assert.equal((await (await fresh()).getPublicConfig(url)).needsSetup, true);

  // The owner account needs the one-time setup code from the server log.
  await assert.rejects(web('POST', '/v1/super/setup', { code: 'guess', username: 'owner', password: 'owner-password-1' }, {}), /401 Wrong setup code/);
  const code = (await srv.meta('setup_code'))!;
  assert.ok(code.length >= 10);
  await web('POST', '/v1/super/setup', { code, username: 'owner', password: 'owner-password-1' }, {});
  assert.equal((await (await fresh()).getPublicConfig(url)).needsSetup, false);
  await assert.rejects(web('POST', '/v1/super/setup', { code, username: 'x_y', password: 'password-123' }, {}), /409/);

  // Owner signs in with ID + password only (no company code).
  await assert.rejects(web('POST', '/v1/super/session', { username: 'owner', password: 'wrong-password' }, {}), /401/);
  const { token } = await web<{ token: string }>('POST', '/v1/super/session', { username: 'owner', password: 'owner-password-1' }, {});
  owner = { authorization: `Bearer ${token}` };

  // A paying company: the owner creates it and hands its admin a temporary password (or the QR).
  const acme = await web<{ invite: Invite; tempPassword: string; code: string }>('POST', '/v1/super/companies', {
    code: 'acme',
    name: 'Acme Ltd',
    adminId: 'boss',
    adminName: 'Acme Boss',
  });
  assert.equal(acme.invite.username, 'boss-acme');
  await assert.rejects(web('POST', '/v1/super/companies', { code: 'acme', name: 'Again', adminId: 'x_y' }), /already used/);
  const boss = await fresh();
  await assert.rejects(boss.login(url, makeUsername('boss', 'acme'), acme.tempPassword), MustChangePasswordError);
  await boss.login(url, 'boss-acme', acme.tempPassword, 'boss-password-1');
  await online(boss);
  await waitFor(() => boss.isAdmin && !boss.isSuper && boss.company?.name === 'Acme Ltd', 'boss is acme admin');
  await assert.rejects(boss.inviteEmployee({ username: 'ravi-beta', name: 'x' }), /ID must be/); // can't make people elsewhere
  assert.equal((await fetch(`${url}/v1/super/companies`, { headers: deviceAuth(boss) })).status, 403);

  // A second company; the same ID can exist in both.
  const beta = await web<{ invite: Invite }>('POST', '/v1/super/companies', { code: 'beta', name: 'Beta Corp', adminId: 'boss' });
  assert.equal(beta.invite.username, 'boss-beta');
  const betaBoss = await joinWith(beta.invite, 'beta-boss-pw-1');
  await waitFor(() => betaBoss.isAdmin && betaBoss.company?.code === 'beta', 'beta admin');

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
  await ravi.setUserAdmin('ravi-acme', false);
  await waitFor(() => !ravi.isAdmin, 'ravi no longer admin');
  await assert.rejects(boss.setUserAdmin('boss-acme', false), /at least one admin/);

  // The owner moves ravi to beta (as "ravi.k", since beta already has a ravi).
  const raviApp = await fresh();
  await raviApp.login(url, 'ravi-acme', 'ravi-password-1');
  await online(raviApp);
  await raviApp.addContact('boss-acme');
  await assert.rejects(web('POST', '/v1/super/transfer', { username: 'ravi-acme', to: 'beta' }), /already used in beta/);
  const moved = await web<{ username: string; invite: Invite; returning: boolean }>('POST', '/v1/super/transfer', {
    username: 'ravi-acme',
    to: 'beta',
    id: 'ravi.k',
  });
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
  const back = await web<{ username: string; invite: Invite; returning: boolean }>('POST', '/v1/super/transfer', {
    username: 'ravi.k-beta',
    to: 'acme',
    id: 'ravi',
  });
  assert.equal(back.username, 'ravi-acme');
  assert.equal(back.returning, true);
  await waitFor(() => raviApp.moved, 'app sees the second move');
  await raviApp.join(inviteCode(url, back.invite), 'ravi-back-pw-11');
  await online(raviApp);
  assert.equal(raviApp.account!.username, 'ravi-acme');
  assert.ok(!(await boss.listAllUsers()).find((u) => u.username === 'ravi-acme')!.moved);
  await raviApp.sendText('boss-acme', 'back again');
  await waitFor(() => boss.getMessages('ravi-acme').some((m) => m.text === 'back again'), 'message after coming back');

  const { companies } = await web<{ companies: { code: string; name: string; users: number }[] }>('GET', '/v1/super/companies');
  assert.deepEqual(
    companies.map((c) => [c.code, c.name, c.users]),
    [
      ['acme', 'Acme Ltd', 2],
      ['beta', 'Beta Corp', 2],
    ],
  );
});

test('a company asked for in the app waits for the owner; suspend cuts it off; the web session ends on sign-out', async () => {
  const gita = await fresh();
  await gita.requestCompany(url, { companyCode: 'gamma', companyName: 'Gamma Traders', id: 'gita', password: 'gita-password-1' });
  assert.equal(gita.account!.username, 'gita-gamma');
  gita.connect();
  await waitFor(() => gita.pending, 'waiting for approval');
  assert.equal(gita.status, 'offline');
  await assert.rejects((await fresh()).login(url, 'gita-gamma', 'gita-password-1'), /waiting for approval/);
  await assert.rejects(
    (await fresh()).requestCompany(url, { companyCode: 'gamma', companyName: 'Copy', id: 'x_y', password: 'password-123' }),
    /already used/,
  );

  const page = await fetch(`${url}/super`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  await assert.rejects(web('POST', '/v1/super/session', { username: 'gita-gamma', password: 'gita-password-1' }, {}), /401/);
  const list = await web<{ companies: { code: string; status: string }[] }>('GET', '/v1/super/companies');
  assert.deepEqual(list.companies[0], { ...list.companies[0], code: 'gamma', status: 'pending' }); // waiting ones first
  await assert.rejects(web('GET', '/v1/admin/users'), /401/); // the web sign-in only opens the owner pages

  // Approve: the app connects (it checks back every minute; reconnect now to keep the test short).
  await web('PUT', '/v1/super/companies/gamma/status', { status: 'active' });
  gita.disconnect();
  await online(gita);
  await waitFor(() => gita.isAdmin && gita.company?.name === 'Gamma Traders' && !gita.pending, 'approved');
  const created = await web<{ code: string; qrSvg: string }>('POST', '/v1/super/companies', { code: 'delta', name: 'Delta', adminId: 'dev' });
  assert.match(created.code, /^cellmate:\/\/join\?/);
  assert.match(created.qrSvg, /^<svg/);

  await web('PUT', '/v1/super/companies/gamma/status', { status: 'suspended' });
  await waitFor(() => gita.status !== 'online', 'suspended company disconnected');
  assert.ok(gita.account);
  await web('DELETE', '/v1/super/session');
  await assert.rejects(web('GET', '/v1/super/companies'), /401/);
});
