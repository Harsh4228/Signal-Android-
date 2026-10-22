import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBlobStorage, MemoryStorage, MessengerClient, randomBytes } from '@meetme/core';
import { startTestServer } from './harness';

// Media & docs: photos and documents of each chat are kept on the device, encrypted, and survive a restart.
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

/** Blob store that remembers everything written, to check nothing readable reaches the disk. */
class SpyBlobs extends MemoryBlobStorage {
  written: Uint8Array[] = [];
  override async write(id: string, data: Uint8Array) {
    this.written.push(data);
    await super.write(id, data);
  }
}

async function device(storage = new MemoryStorage(), blobs = new SpyBlobs()) {
  const c = new MessengerClient(storage, { blobs });
  clients.push(c);
  await c.init();
  return { c, storage, blobs };
}

async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}

const contains = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

test('photos and documents are kept per chat, encrypted, across restarts; deleting removes them', async () => {
  const { c: admin, blobs: adminBlobs } = await device();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  await admin.createEmployee('asha', 'temp-password-1');
  await admin.createEmployee('bina', 'temp-password-1');
  const asha = await device();
  await asha.c.login(url, 'asha', 'temp-password-1', 'asha-own-secret');
  await online(asha.c);
  const bina = await device();
  await bina.c.login(url, 'bina', 'temp-password-1', 'bina-own-secret');
  await online(bina.c);

  const photo = randomBytes(5000);
  const pdf = randomBytes(8000);
  await admin.sendFile('asha', { name: 'site.jpg', mime: 'image/jpeg', data: photo }, 'the site');
  await admin.sendFile('asha', { name: 'invoice.pdf', mime: 'application/pdf', data: pdf });
  await waitFor(() => asha.c.getMedia('admin').length === 2, 'asha keeps both files');
  await waitFor(() => admin.getMedia('asha').length === 2, 'admin keeps the sent files');

  const [newest, older] = asha.c.getMedia('admin');
  assert.equal(newest!.name, 'invoice.pdf');
  assert.equal(newest!.kind, 'pdf');
  assert.equal(older!.kind, 'image');
  assert.equal(older!.caption, 'the site');
  assert.equal(older!.from, 'admin');
  assert.equal(asha.c.getMedia('bina').length, 0); // per chat

  // Only ciphertext reaches the blob store.
  for (const w of asha.blobs.written) assert.ok(!contains(w, photo.subarray(0, 64)) && !contains(w, pdf.subarray(0, 64)));

  // Restart: messages are gone (memory only) but the media page still has the files.
  asha.c.dispose();
  const again = await device(asha.storage, asha.blobs);
  assert.equal(again.c.getMessages('admin').length, 0);
  const items = again.c.getMedia('admin');
  assert.equal(items.length, 2);
  assert.deepEqual((await again.c.openMedia(items.find((m) => m.name === 'site.jpg')!)).data, photo);
  await online(again.c);

  // Delete for everyone removes it from the receiver's device too.
  const sent = admin.getMessages('asha').find((m) => m.attachment?.name === 'site.jpg')!;
  await admin.deleteMessage('asha', sent.id, true);
  await waitFor(() => again.c.getMedia('admin').length === 1, 'deleted for everyone');
  await waitFor(() => admin.getMedia('asha').length === 1, 'deleted on the sender too');

  // The same file to two chats (like an announcement) is stored once.
  const before = adminBlobs.written.length;
  const memo = randomBytes(3000);
  await admin.broadcast('memo', { name: 'memo.pdf', mime: 'application/pdf', data: memo });
  await waitFor(() => admin.getMedia('bina').length === 1 && admin.getMedia('asha').length === 2, 'broadcast saved');
  assert.equal(adminBlobs.written.length - before, 1);
  await waitFor(() => bina.c.getMedia('admin').length === 1, 'bina keeps the memo');

  // Clearing the chat removes its media (admins may always clear).
  admin.clearChat('asha');
  await waitFor(() => admin.getMedia('asha').length === 0, 'cleared');
  assert.equal(admin.getMedia('bina').length, 1); // the shared file is still used by bina's chat
  assert.deepEqual((await admin.openMedia(admin.getMedia('bina')[0]!)).data, memo);

  // Employees without "clear history" can't delete saved files.
  await assert.rejects(bina.c.deleteMedia(bina.c.getMedia('admin')[0]!), /turned off/);

  // Disappearing messages are never written to the device.
  await admin.setDisappearingTimer('bina', 300);
  await admin.sendFile('bina', { name: 'secret.jpg', mime: 'image/jpeg', data: randomBytes(1000) });
  await waitFor(() => bina.c.getMessages('admin').some((m) => m.attachment?.name === 'secret.jpg' && m.attachment.state === 'ready'), 'secret arrives');
  assert.ok(!bina.c.getMedia('admin').some((m) => m.name === 'secret.jpg'));
  assert.ok(!admin.getMedia('bina').some((m) => m.name === 'secret.jpg'));

  // Logging out deletes every saved file.
  await bina.c.logout();
  assert.equal(await bina.blobs.read(admin.getMedia('bina')[0]!.blob), null);
});
