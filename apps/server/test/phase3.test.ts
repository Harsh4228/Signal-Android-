import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, inviteCode, MAX_FILES_AT_ONCE } from '@meetme/core';
import { startTestServer } from './harness';

// The "safe 20": chat lock / wallpaper / tone / drafts / text size, stickers, voice waveforms, status mute /
// reactions / voice notes, call links and group invite links with admin approval.
let srv: Awaited<ReturnType<typeof startTestServer>>;
let url = '';
const clients: MessengerClient[] = [];
let admin: MessengerClient;

async function waitFor(fn: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}
async function join(username: string, storage = new MemoryStorage()) {
  const invite = await admin.inviteEmployee({ username, name: username });
  const c = new MessengerClient(storage);
  clients.push(c);
  await c.init();
  await c.join(inviteCode(url, invite), `${username}-password`);
  return online(c);
}

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['admin'], openRegistration: false });
  url = srv.url;
  admin = new MessengerClient(new MemoryStorage());
  clients.push(admin);
  await admin.init();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
});
after(async () => {
  clients.forEach((c) => c.dispose());
  await new Promise((r) => setTimeout(r, 100));
  await srv.close();
});

test('chat lock, wallpaper, tone, drafts and text size; kept over a restart', async () => {
  const storage = new MemoryStorage();
  const a = await join('amy', storage);
  const b = await join('bob');
  await a.addContact('bob');
  await a.sendText('bob', 'hi');
  assert.ok(a.orderedChats().includes('bob'));

  a.lockChat('bob', true);
  assert.ok(!a.orderedChats().includes('bob'), 'locked chats leave the main list');
  assert.deepEqual(a.lockedChats(), ['bob']);
  assert.ok(!a.orderedChats({ archived: true }).includes('bob'));

  a.setChatWallpaper('bob', 'mint');
  assert.equal(a.wallpaperOf('bob'), 'mint');
  assert.throws(() => a.setChatWallpaper('bob', 'neon'));
  a.setAppearance({ wallpaper: 'sky', fontSize: 'large', tone: 'bell' });
  assert.equal(a.wallpaperOf('someone-else'), 'sky');
  a.setChatTone('bob', 'soft');
  assert.equal(a.toneOf('bob'), 'soft');

  // Tones: not for the open chat, not for muted chats.
  await b.sendText('amy', 'ping');
  await waitFor(() => a.getMessages('bob').some((m) => m.text === 'ping'), 'ping');
  const ping = a.getMessages('bob').find((m) => m.text === 'ping')!;
  assert.equal(a.toneFor(ping), 'soft');
  a.setActiveChat('bob');
  assert.equal(a.toneFor(ping), null);
  a.setActiveChat(null);
  a.muteChat('bob', 3600_000);
  assert.equal(a.toneFor(ping), null);

  a.setDraft('bob', 'half a sentence');
  assert.equal(a.hasDraft('bob'), true);
  await new Promise((r) => setTimeout(r, 900)); // drafts are saved shortly after typing stops

  // Over a restart (same device storage) everything comes back.
  const again = new MessengerClient(storage);
  clients.push(again);
  await again.init();
  assert.equal(again.isLocked('bob'), true);
  assert.equal(again.wallpaperOf('bob'), 'mint');
  assert.equal(again.appearance.fontSize, 'large');
  assert.equal(again.getDraft('bob'), 'half a sentence');
  again.dispose();
});

test('stickers, voice waveforms, 30 files at once', async () => {
  assert.equal(MAX_FILES_AT_ONCE, 30);
  const a = await join('cat');
  const b = await join('dan');
  await a.addContact('dan');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array(400).fill(3)]);
  await a.sendSticker('dan', { name: 'sticker.png', mime: 'image/png', data: png });
  await waitFor(() => b.getMessages('cat').some((m) => m.sticker && !!m.attachment?.data), 'sticker arrived');
  await assert.rejects(a.sendSticker('dan', { name: 'a.pdf', mime: 'application/pdf', data: png }), /must be a picture/);

  await b.addSticker({ mime: 'image/png', data: png });
  const mine = await b.myStickers();
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0]!.data, png);
  await b.removeSticker(mine[0]!.id);
  assert.equal((await b.myStickers()).length, 0);

  await a.sendFile('dan', { name: 'voice.m4a', mime: 'audio/mp4', data: png, wave: '0137fca8531' });
  await waitFor(() => b.getMessages('cat').some((m) => m.attachment?.kind === 'audio'), 'voice arrived');
  assert.equal(b.getMessages('cat').find((m) => m.attachment?.kind === 'audio')!.attachment!.wave, '0137fca8531');
  await a.sendFile('dan', { name: 'v2.m4a', mime: 'audio/mp4', data: png, wave: 'not a wave!' });
  await waitFor(() => b.getMessages('cat').filter((m) => m.attachment?.kind === 'audio').length === 2, 'second voice');
  assert.equal(b.getMessages('cat').filter((m) => m.attachment?.kind === 'audio')[1]!.attachment!.wave, undefined);
});

test('status: voice note, reactions as replies, muting someone', async () => {
  const a = await join('eve');
  const b = await join('fay');
  await a.addContact('fay');
  await b.addContact('eve');
  await a.sendText('fay', 'hello');
  await waitFor(() => b.getMessages('eve').length === 1, 'hello');

  const voice = new Uint8Array(5000).fill(9);
  await a.postStatus({ photo: { name: 'v.m4a', mime: 'audio/mp4', data: voice, wave: '13579bdf' } });
  await waitFor(() => b.statusGroups().some((g) => g.user === 'eve'), 'voice status arrived');
  const st = b.statusGroups().find((g) => g.user === 'eve')!.items[0]!;
  assert.equal(st.photo?.mime, 'audio/mp4');
  assert.equal(st.photo?.wave, '13579bdf');

  await b.reactToStatus(st, '🔥');
  await waitFor(() => a.getMessages('fay').some((m) => m.text === '🔥' && !!m.replyTo), 'reaction arrived as a reply');
  await assert.rejects(b.reactToStatus(st, '🦄'), /Unknown reaction/);

  b.muteStatus('eve', true);
  assert.equal(b.statusGroups().find((g) => g.user === 'eve')!.muted, true);
  assert.equal(b.statusRingOf('eve'), null);
  b.muteStatus('eve', false);
  assert.equal(b.statusRingOf('eve'), 'new');
});

test('call links and group invite links: requests go to admins, who approve them', async () => {
  const a = await join('gus');
  const g = await admin.createGroup('Projects', ['admin', 'gus']);
  const key = `#${g.id}`;
  await waitFor(() => !!a.groupOf(key), 'group loaded');

  const call = a.callLink(key);
  const link = a.groupLink(key);
  assert.deepEqual(a.parseAppLink(call), { kind: 'call', group: key });
  assert.deepEqual(a.parseAppLink(link), { kind: 'group', group: key });
  assert.equal(a.parseAppLink('https://example.com/g/' + g.id), null);
  assert.throws(() => a.callLink('gus'));

  // The link opened in a browser explains itself and says nothing about the group.
  const page = await fetch(link, { headers: { accept: 'text/html' } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Ask to join the group/);
  assert.ok(!html.includes('Projects'));

  // Someone outside the group asks; the admin approves; they are in.
  const h = await join('hal');
  await assert.rejects(a.requestToJoin(key), /already in this group/);
  await h.requestToJoin(key);
  await waitFor(() => admin.joinRequests.some((r) => r.group === key && r.user === 'hal'), 'request reached the admin');
  await admin.answerJoinRequest(key, 'hal', true);
  assert.equal(admin.joinRequests.length, 0);
  await waitFor(() => !!h.groupOf(key), 'hal is in the group', 10000);

  // A declined request just goes away.
  const i = await join('ivy');
  await i.requestToJoin(key);
  await waitFor(() => admin.joinRequests.some((r) => r.user === 'ivy'), 'second request');
  await admin.answerJoinRequest(key, 'ivy', false);
  assert.ok(!admin.joinRequests.length);
  assert.equal(i.groupOf(key), undefined);
});
