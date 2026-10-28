import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBlobStorage, MemoryStorage, MessengerClient, inviteCode } from '@meetme/core';
import { startTestServer } from './harness';

// Chat history survives an app restart, and comes back on a new device after logging in (like WhatsApp).
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

async function device(storage = new MemoryStorage(), blobs = new MemoryBlobStorage()) {
  const c = new MessengerClient(storage, { blobs });
  clients.push(c);
  await c.init();
  return c;
}

async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}

test('history: kept across restarts, restored on a new device, and after a password reset with the old password', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');

  const invite = await admin.inviteEmployee({ username: 'ravi', name: 'Ravi' });
  const storage = new MemoryStorage();
  const blobs = new MemoryBlobStorage();
  const phone = await device(storage, blobs);
  await phone.join(inviteCode(url, invite), 'ravi-password-1');
  await online(phone);

  await phone.addContact('admin');
  await phone.sendText('admin', 'hello from the phone');
  await waitFor(() => admin.getMessages('ravi').length === 1, 'admin got it');
  await admin.sendText('ravi', 'hi ravi');
  await waitFor(() => phone.getMessages('admin').length === 2, 'phone got the reply');
  await phone.flushHistory();
  assert.ok(phone.lastBackupAt, 'backed up');

  // 1. The app restarts on the same phone: the chat is still there.
  phone.dispose();
  const again = await device(storage, blobs);
  assert.deepEqual(
    again.getMessages('admin').map((m) => m.text),
    ['hello from the phone', 'hi ravi'],
  );
  again.dispose();

  // 2. Logging in on a new device (the desktop) brings the chat back from the encrypted backup.
  const desktop = await device();
  await desktop.login(url, 'ravi', 'ravi-password-1');
  await waitFor(() => desktop.getMessages('admin').length === 2, 'restored on the new device');
  assert.equal(desktop.getMessages('admin')[1]!.text, 'hi ravi');
  assert.ok(desktop.contacts.includes('admin'));
  await online(desktop);

  // 3. The admin resets the password: the backup stays locked until the old password is given.
  await admin.resetEmployeePassword('ravi', 'temp-password-9');
  const tablet = await device();
  await assert.rejects(tablet.login(url, 'ravi', 'temp-password-9'), /new password/i);
  await tablet.login(url, 'ravi', 'temp-password-9', 'ravi-password-2');
  assert.equal(tablet.backupLocked, true);
  assert.equal(tablet.getMessages('admin').length, 0);
  await assert.rejects(tablet.restoreOldBackup('wrong-password'), /does not open/);
  const n = await tablet.restoreOldBackup('ravi-password-1');
  assert.equal(n, 2);
  assert.equal(tablet.backupLocked, false);
  assert.equal(tablet.getMessages('admin')[0]!.text, 'hello from the phone');
});

test('an account signed in before backups existed turns them on with its password; starred messages move too', async () => {
  const admin = clients.find((c) => c.account?.username === 'admin')!;
  const invite = await admin.inviteEmployee({ username: 'old', name: 'Old Phone' });
  const storage = new MemoryStorage();
  const blobs = new MemoryBlobStorage();
  let phone = await device(storage, blobs);
  await phone.join(inviteCode(url, invite), 'old-password-1');
  // Like an app updated while signed in: no backup key yet.
  await (phone as unknown as { store: { setSetting(k: string, v: unknown): Promise<void> } }).store.setSetting('backupKeys', null);
  phone.dispose();
  phone = await device(storage, blobs);
  await online(phone);
  assert.equal(phone.backupNeedsPassword, true);
  await assert.rejects(phone.enableBackup('wrong-password'), /wrong/);

  await phone.addContact('admin');
  await phone.sendText('admin', 'keep me');
  phone.toggleStar(phone.getMessages('admin')[0]!);
  await phone.enableBackup('old-password-1');
  assert.equal(phone.backupNeedsPassword, false);
  assert.ok(phone.lastBackupAt);

  const laptop = await device();
  await laptop.login(url, 'old', 'old-password-1');
  await waitFor(() => laptop.getMessages('admin').length === 1, 'restored');
  assert.equal(laptop.starredMessages().length, 1);
});