import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, type ChatMessage } from '@meetme/core';
import { startTestServer } from './harness';

// Sharing outside CellMate (WhatsApp, email...): off unless the admin allows it; the admins see each share in the
// audit log (who, from which chat, what kind) but never the content.
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

async function waitFor(fn: () => boolean, what: string, ms = 8000) {
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

test('share outside: off by default, allowed per person by the admin, logged without the content', async () => {
  const admin = await user('admin');
  await waitFor(() => admin.isAdmin, 'admin');
  const asha = await user('asha');
  await user('bina');
  await asha.addContact('bina');
  const text = { id: '1', peer: 'bina', text: 'secret plan', ts: Date.now(), outgoing: false } as ChatMessage;
  const photo = { ...text, id: '2', text: '', attachment: { kind: 'image', mime: 'image/jpeg', name: 'p.jpg', data: new Uint8Array([1, 2, 3]) } } as ChatMessage;
  const pending = { ...photo, id: '3', attachment: { ...photo.attachment!, data: undefined } } as ChatMessage;

  // Off by default.
  assert.equal(asha.canShareOut(text, 'bina'), false);
  assert.equal(asha.canShareOut(photo, 'bina'), false);

  // The admin allows it for asha.
  await admin.setRight({ feature: 'shareOut', scope: 'user', target: 'asha', allow: true });
  await waitFor(() => asha.canShareOut(text, 'bina'), 'asha may share');
  assert.equal(asha.canShareOut(photo, 'bina'), true);
  assert.equal(asha.canShareOut(pending, 'bina'), false); // not downloaded yet
  assert.equal(asha.canShareOut({ ...photo, viewOnce: true } as ChatMessage, 'bina'), false); // never view-once
  assert.equal(admin.canShareOut(text, 'bina'), true); // admins always may

  // Each share is in the audit log, without the content.
  asha.noteSharedOut(photo, 'bina');
  asha.noteSharedOut(text, 'bina');
  let log: { action: string; actor: string; target: string; detail: string }[] = [];
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    log = (await admin.getAuditLog()).filter((e) => e.action === 'share.out');
    if (log.length >= 2) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(log.length, 2);
  assert.ok(log.every((e) => e.actor === 'asha' && e.target === 'chat with bina'));
  assert.ok(log.some((e) => e.detail === 'photos (image/jpeg)'));
  assert.ok(log.some((e) => e.detail === 'text'));
  assert.ok(!JSON.stringify(log).includes('secret plan'));
});
