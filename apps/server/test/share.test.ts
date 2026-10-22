import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

// Files can be shared on to other chats by everyone; nobody may take them out of the app.
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

async function fresh() {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  return c;
}

async function employee(admin: MessengerClient, name: string, canShare?: boolean) {
  await admin.createEmployee(name, 'temp-password-1', [], { canShare });
  const c = await fresh();
  await c.login(url, name, 'temp-password-1', `${name}-own-secret`);
  c.connect();
  await waitFor(() => c.status === 'online', `${name} online`);
  return c;
}

test('everyone can share a received file to another chat; nobody is allowed to save it outside', async () => {
  const admin = await fresh();
  await admin.register(url, 'admin');
  admin.connect();
  await waitFor(() => admin.status === 'online' && admin.isAdmin, 'admin online');

  // An old admin app may still ask for the "save & share" right: it no longer grants anything.
  const asha = await employee(admin, 'asha', true);
  const bina = await employee(admin, 'bina');
  const chirag = await employee(admin, 'chirag');
  await admin.setCanShare('bina', true);
  await new Promise((r) => setTimeout(r, 200));
  for (const c of [admin, asha, bina]) assert.equal(c.canShare, false); // older apps hide Save outside when false
  assert.ok((await admin.listAllUsers()).every((u) => !u.canShare));

  const pdf = new TextEncoder().encode('%PDF-1.4 policy document');
  for (const to of ['asha', 'bina']) await admin.sendFile(to, { name: 'policy.pdf', mime: 'application/pdf', data: pdf });
  const received = (c: MessengerClient) => c.getMessages('admin').find((m) => m.attachment?.state === 'ready')?.attachment;
  await waitFor(() => !!received(asha) && !!received(bina), 'files decrypted');

  // Both may pass it on inside the app.
  await asha.forwardAttachment('chirag', received(asha)!);
  await bina.forwardAttachment('chirag', received(bina)!);
  await waitFor(() => chirag.getMessages('asha').some((m) => m.attachment?.state === 'ready'), 'from asha');
  await waitFor(() => chirag.getMessages('bina').some((m) => m.attachment?.state === 'ready'), 'from bina');
  assert.deepEqual(chirag.getMessages('asha').find((m) => m.attachment)!.attachment!.data, pdf);
});
