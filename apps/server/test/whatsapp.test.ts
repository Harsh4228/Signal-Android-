import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, inviteCode } from '@meetme/core';
import { startTestServer } from './harness';

// WhatsApp-style extras: mentions, view once, pin / archive / mute, read receipts off, hidden last seen, About.
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

async function waitFor(fn: () => boolean, what: string, ms = 6000) {
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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(200).fill(7)]);

test('mentions, view once, pin / archive / mute, privacy', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  const join = async (username: string, name: string) => {
    const invite = await admin.inviteEmployee({ username, name });
    const c = await device();
    await c.join(inviteCode(url, invite), `${username}-password`);
    return online(c);
  };
  const asha = await join('asha', 'Asha Rao');
  const ben = await join('ben', 'Ben Paul');

  // @mentions in a group
  const g = await admin.createGroup('Team', ['admin', 'asha', 'ben']);
  await waitFor(() => !!asha.groupOf(`#${g.id}`) && !!ben.groupOf(`#${g.id}`), 'groups loaded');
  await asha.sendText(`#${g.id}`, 'Hi @ben, can you check this?');
  await waitFor(() => ben.getMessages(`#${g.id}`).length === 1, 'ben got it');
  assert.deepEqual(ben.getMessages(`#${g.id}`)[0]!.mentions, ['ben']);
  assert.equal(ben.mentionsMe(`#${g.id}`), true);
  assert.equal(admin.mentionsMe(`#${g.id}`), false);

  // View once: opened one time, then gone; the sender sees "Opened"
  await asha.addContact('ben');
  await asha.sendFile('ben', { name: 'p.png', mime: 'image/png', data: PNG }, '', { viewOnce: true });
  await waitFor(() => ben.getMessages('asha').some((m) => m.viewOnce && !!m.attachment?.data), 'view once arrived');
  const vo = ben.getMessages('asha').find((m) => m.viewOnce)!;
  assert.ok(ben.viewOnceFile(vo));
  ben.closeViewOnce(vo);
  assert.equal(ben.viewOnceFile(vo), null);
  assert.equal(vo.attachment?.data, undefined);
  await waitFor(() => asha.getMessages('ben').some((m) => m.viewOnce && m.opened), 'sender sees opened');
  await assert.rejects(asha.sendFile('ben', { name: 'a.pdf', mime: 'application/pdf', data: PNG }, '', { viewOnce: true }), /photos and videos/);

  // Pin / archive / mute
  ben.pinChat('asha', true);
  assert.equal(ben.orderedChats()[0], 'asha');
  ben.archiveChat(`#${g.id}`, true);
  assert.ok(!ben.orderedChats().includes(`#${g.id}`));
  assert.deepEqual(ben.orderedChats({ archived: true }), [`#${g.id}`]);
  // A new message brings it back...
  await admin.sendText(`#${g.id}`, 'meeting at 3');
  await waitFor(() => !ben.isArchived(`#${g.id}`), 'unarchived by a new message');
  // ...unless the chat is muted.
  ben.muteChat(`#${g.id}`, 8 * 3600_000);
  ben.archiveChat(`#${g.id}`, true);
  await admin.sendText(`#${g.id}`, 'still on?');
  await waitFor(() => ben.getMessages(`#${g.id}`).length === 3, 'third message');
  assert.equal(ben.isArchived(`#${g.id}`), true);

  // Read receipts off: Asha sees "delivered" only; message info has the times
  await asha.setReadReceipts(false);
  await ben.sendText('asha', 'did you see it?');
  await waitFor(() => asha.getMessages('ben').some((m) => m.text === 'did you see it?'), 'asha got it');
  asha.setActiveChat('ben');
  await waitFor(() => ben.getMessages('asha').some((m) => m.text === 'did you see it?' && m.status === 'delivered'), 'delivered');
  await new Promise((r) => setTimeout(r, 300));
  const sent = ben.getMessages('asha').find((m) => m.text === 'did you see it?')!;
  assert.equal(sent.status, 'delivered');
  assert.ok(sent.deliveredAt);

  // About + hidden last seen
  await asha.setPrivacy({ about: 'At the Pune office', hideLastSeen: true });
  assert.equal((await ben.listDirectory()).find((u) => u.username === 'asha')!.about, 'At the Pune office');
  await ben.refreshPresence(['asha']);
  assert.equal(ben.getPresence('asha')?.lastSeen, null);
  assert.equal(ben.getPresence('asha')?.online, false);
});
