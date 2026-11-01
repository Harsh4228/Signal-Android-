import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, groupKey } from '@meetme/core';
import { startTestServer } from './harness';

// Group photos: group admins and company admins set them; every member sees them; ordinary members can't change them.
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);

test('group photo: group admins set it, members see it, others cannot change it', async () => {
  const admin = await user('admin');
  await waitFor(() => admin.isAdmin, 'admin');
  const asha = await user('asha');
  const bina = await user('bina');
  const g = await admin.createGroup('Team', ['admin', 'asha', 'bina'], null, ['asha']);
  const key = groupKey(g.id);
  await waitFor(() => !!bina.groupOf(key) && !!asha.groupOf(key), 'groups loaded');
  assert.equal(bina.avatarOf(key), undefined);

  // A plain member may not change it; not a valid image is refused.
  await assert.rejects(bina.setGroupPhoto(g.id, { mime: 'image/png', data: PNG }), /Only group admins/);
  await assert.rejects(asha.setGroupPhoto(g.id, { mime: 'image/png', data: new Uint8Array([1, 2, 3]) }), /not a valid photo/);

  // The group admin sets it: every member gets it.
  await asha.setGroupPhoto(g.id, { mime: 'image/png', data: PNG });
  await waitFor(() => !!bina.avatarOf(key), 'bina sees the photo');
  assert.match(bina.avatarOf(key)!, /^data:image\/png;base64,/);
  assert.equal(typeof bina.groupOf(key)!.photo, 'number');

  // Removed by the company admin: gone for everyone.
  await admin.setGroupPhoto(g.id, null);
  await waitFor(() => bina.avatarOf(key) === undefined, 'photo removed for bina');
  assert.equal(bina.groupOf(key)!.photo, undefined);
});
