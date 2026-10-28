import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, inviteCode } from '@meetme/core';
import { startTestServer } from './harness';

// Channels (one-way, anyone may follow, only their admins post) and communities (groups put together).
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

test('channels: follow and leave; only channel admins post; communities group them', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  const join = async (username: string) => {
    const invite = await admin.inviteEmployee({ username, name: username });
    const c = await device();
    await c.join(inviteCode(url, invite), `${username}-password`);
    return online(c);
  };
  const editor = await join('editor');
  const reader = await join('reader');

  const ch = await admin.createGroup('Company news', ['admin', 'editor'], null, ['editor'], 'channel');
  assert.equal(ch.kind, 'channel');
  const key = `#${ch.id}`;

  // Anyone can see it and follow it.
  const list = await reader.listChannels();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.following, false);
  await reader.followChannel(ch.id, true);
  await waitFor(() => !!reader.groupOf(key), 'reader follows');
  assert.equal(reader.isChannel(key), true);
  assert.equal((await reader.listChannels())[0]!.followers, 3);

  // Only the channel admin (and company admins) post; followers read.
  await waitFor(() => !!editor.groupOf(key) && editor.canSendTo(key), 'editor may post');
  assert.equal(reader.canSendTo(key), false);
  await editor.sendText(key, 'Office closed on Friday');
  await waitFor(() => reader.getMessages(key).length === 1, 'reader got the post');

  // Leaving
  await reader.followChannel(ch.id, false);
  await waitFor(() => !reader.groupOf(key), 'reader left');

  // Communities
  const team = await admin.createGroup('Pune team', ['admin', 'editor', 'reader']);
  const saved = await admin.setCommunities([{ name: 'Pune office', description: 'Everything for Pune', groups: [ch.id, team.id, 'ffffffffffffffff'] }]);
  assert.deepEqual(saved[0]!.groups, [ch.id, team.id]); // unknown ids are dropped
  const seen = await reader.listCommunities();
  assert.equal(seen[0]!.name, 'Pune office');
  await waitFor(() => reader.groupOf(`#${team.id}`)?.community === saved[0]!.id, 'group knows its community');
  await assert.rejects(reader.setCommunities([]), /admin only/);
});
