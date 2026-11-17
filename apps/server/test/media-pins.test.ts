import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, inviteCode } from '@meetme/core';
import { startTestServer } from './harness';

// Videos and preview pictures, retrying a failed download, pinned messages, and the streamed attachment store.
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

test('videos with previews, big files streamed, download retry, pinned messages', async () => {
  const admin = new MessengerClient(new MemoryStorage());
  clients.push(admin);
  await admin.init();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  const join = async (username: string) => {
    const invite = await admin.inviteEmployee({ username, name: username });
    const c = new MessengerClient(new MemoryStorage());
    clients.push(c);
    await c.init();
    await c.join(inviteCode(url, invite), `${username}-password`);
    return online(c);
  };
  const asha = await join('asha');
  const ben = await join('ben');
  await asha.addContact('ben');

  // A video (several MB, so the server streams it in many pieces) with a preview picture.
  const video = new Uint8Array(3 * 1024 * 1024 + 7).map((_, i) => (i * 31) & 0xff);
  const thumb = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA==';
  await asha.sendFile('ben', { name: 'clip.mp4', mime: 'video/mp4', data: video, thumb });
  await waitFor(() => !!ben.getMessages('asha').find((m) => m.attachment?.kind === 'video')?.attachment?.data, 'video arrived', 20000);
  const got = ben.getMessages('asha').find((m) => m.attachment?.kind === 'video')!;
  assert.equal(got.attachment!.thumb, thumb);
  assert.deepEqual(got.attachment!.data, video);
  assert.equal(MessengerClient.preview(got), '🎥 Video');

  // A broken preview is dropped, the file still arrives.
  await asha.sendFile('ben', { name: 'p.png', mime: 'image/png', data: video.slice(0, 500), thumb: 'not base64 !!' });
  await waitFor(() => !!ben.getMessages('asha').find((m) => m.attachment?.name === 'p.png')?.attachment?.data, 'photo arrived');
  assert.equal(ben.getMessages('asha').find((m) => m.attachment?.name === 'p.png')!.attachment!.thumb, undefined);

  // Retry a download that failed.
  const a = got.attachment!;
  a.data = undefined;
  a.state = 'failed';
  await ben.retryDownload('asha', got.id);
  assert.equal(a.state, 'ready');
  assert.deepEqual(a.data, video);

  // The server refuses broken uploads.
  const auth = 'Basic ' + Buffer.from(`asha:${(asha as unknown as { account: { password: string } }).account.password}`).toString('base64');
  const bad = await fetch(`${url}/v1/attachments`, { method: 'POST', headers: { 'content-type': 'text/plain', authorization: auth }, body: 'abc$%' + 'A'.repeat(100) });
  assert.equal(bad.status, 400);

  // Pinned messages: everyone in the chat sees them; a 4th pin replaces the oldest; unpin works.
  for (const t of ['one', 'two', 'three', 'four']) await asha.sendText('ben', t);
  await waitFor(() => ben.getMessages('asha').filter((m) => !m.attachment).length === 4, 'texts arrived');
  const ids = (c: MessengerClient, peer: string) => c.pinnedMessages(peer).map((m) => m.text);
  for (const t of ['one', 'two', 'three', 'four']) {
    const m = ben.getMessages('asha').find((x) => x.text === t)!;
    await ben.pinMessage('asha', m.id, true);
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.deepEqual(ids(ben, 'asha'), ['four', 'three', 'two']);
  await waitFor(() => ids(asha, 'ben').length === 3 && ids(asha, 'ben')[0] === 'four', 'asha sees the pins');
  const four = asha.getMessages('ben').find((x) => x.text === 'four')!;
  await asha.pinMessage('ben', four.id, false);
  await waitFor(() => !ids(ben, 'asha').includes('four'), 'unpinned for ben');

  // In a group where only chosen people may write, the others can't pin.
  const g = await admin.createGroup('News', ['admin', 'asha', 'ben'], ['admin']);
  const key = `#${g.id}`;
  await waitFor(() => !!asha.groupOf(key) && !!ben.groupOf(key), 'group loaded');
  await admin.sendText(key, 'read this');
  await waitFor(() => asha.getMessages(key).length === 1, 'group message');
  await assert.rejects(asha.pinMessage(key, asha.getMessages(key)[0]!.id, true), /Only selected members/);
  await admin.pinMessage(key, admin.getMessages(key)[0]!.id, true);
  await waitFor(() => asha.pinnedMessages(key).length === 1, 'admin pin reached asha');

  // Sending again after a failure.
  const failed = asha.getMessages('ben').find((x) => x.text === 'one')!;
  failed.status = 'failed';
  await asha.retrySend('ben', failed.id);
  await waitFor(() => ben.getMessages('asha').filter((m) => m.text === 'one').length === 2, 'resent message arrived');
});
