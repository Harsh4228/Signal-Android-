import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

// Profile photos: on a company server the admin sets them (profiles are locked); everyone signed in sees them.
// On a server without admins people set their own.
let srv: Awaited<ReturnType<typeof startTestServer>>;
let open: Awaited<ReturnType<typeof startTestServer>>;
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['admin'], openRegistration: true });
  open = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: true });
});
after(async () => {
  clients.forEach((c) => c.dispose());
  await new Promise((r) => setTimeout(r, 100));
  await srv.close();
  await open.close();
});

async function waitFor(fn: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function user(url: string, name: string, storage = new MemoryStorage()) {
  const c = new MessengerClient(storage);
  clients.push(c);
  if (!(await c.init())) await c.register(url, name);
  c.connect();
  await waitFor(() => c.status === 'online', `${name} online`);
  return c;
}

// The smallest valid PNG header + a little body is enough for the server's format check.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

test('company server: the admin sets photos, employees cannot, everyone sees them', async () => {
  const admin = await user(srv.url, 'admin');
  await waitFor(() => admin.isAdmin, 'admin');
  const asha = await user(srv.url, 'asha');
  const bina = await user(srv.url, 'bina');
  await bina.addContact('asha');

  // Locked for employees.
  await assert.rejects(asha.setMyAvatar({ mime: 'image/png', data: PNG }), /Only your admin/);
  await assert.rejects(asha.removeMyAvatar(), /Only your admin/);
  // ...unless the admin gives them the "Change own profile photo" permission.
  await admin.setRight({ feature: 'profilePhoto', scope: 'user', target: 'asha', allow: true });
  await asha.setMyAvatar({ mime: 'image/png', data: PNG });
  await asha.removeMyAvatar();
  await admin.setRight({ feature: 'profilePhoto', scope: 'user', target: 'asha', allow: null });
  await assert.rejects(asha.setMyAvatar({ mime: 'image/png', data: PNG }), /Only your admin/);
  await assert.rejects(asha.setEmployeeAvatar('bina', { mime: 'image/png', data: PNG }), /admin only/);

  // The admin sets it; others pick it up with presence (the chat list refreshes it regularly).
  await admin.setEmployeeAvatar('asha', { mime: 'image/png', data: PNG });
  await bina.refreshPresence();
  await waitFor(() => bina.avatarOf('asha')?.startsWith('data:image/png') === true, 'bina sees the photo');
  await asha.refreshPresence(['asha']);
  assert.ok((await admin.listAllUsers()).find((u) => u.username === 'asha')!.avatar! > 0);

  // Replace, and the checks: only real photos, not too big, not other formats.
  await admin.setEmployeeAvatar('asha', { mime: 'image/jpeg', data: JPEG });
  await bina.refreshPresence();
  await waitFor(() => bina.avatarOf('asha')?.startsWith('data:image/jpeg') === true, 'bina sees the new photo');
  await assert.rejects(admin.setEmployeeAvatar('asha', { mime: 'image/svg+xml', data: PNG }), /JPEG, PNG or WebP/);
  await assert.rejects(admin.setEmployeeAvatar('asha', { mime: 'image/png', data: new Uint8Array(3 * 1024 * 1024) }), /too large/);
  await assert.rejects(admin.setEmployeeAvatar('asha', { mime: 'image/png', data: JPEG }), /not a valid photo/);

  // The admin can still change their own photo.
  await admin.setMyAvatar({ mime: 'image/png', data: PNG });
  assert.ok(admin.avatarOf('admin')!.startsWith('data:image/png'));

  // Removing it: everyone falls back to the initial.
  await admin.setEmployeeAvatar('asha', null);
  await bina.refreshPresence();
  await waitFor(() => bina.avatarOf('asha') === undefined, 'photo gone for bina');
  assert.equal((await admin.listAllUsers()).find((u) => u.username === 'asha')!.avatar, null);
});

test('server without admins: people set, change and remove their own photo', async () => {
  const asha = await user(open.url, 'asha');
  const bina = await user(open.url, 'bina');
  await bina.addContact('asha');
  await asha.setMyAvatar({ mime: 'image/png', data: PNG });
  await bina.refreshPresence();
  await waitFor(() => !!bina.avatarOf('asha'), 'bina sees the photo');

  // My own photo comes back after reconnecting (e.g. app restart).
  const storage = new MemoryStorage();
  const cara = await user(open.url, 'cara', storage);
  await cara.setMyAvatar({ mime: 'image/png', data: PNG });
  cara.dispose();
  const caraAgain = await user(open.url, 'cara', storage);
  await waitFor(() => !!caraAgain.avatarOf('cara'), 'own photo after restart');

  await asha.removeMyAvatar();
  assert.equal(asha.avatarOf('asha'), undefined);
});
