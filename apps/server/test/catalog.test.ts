import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, toBase64 } from '@meetme/core';
import { startTestServer } from './harness';

// Catalogs like WhatsApp Business: every user has their own, changes only that, and can share products into
// chats; colleagues can open someone's catalog from their profile.
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

async function device() {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  return c;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);

test('every user has their own catalog; others can browse it but only the owner changes it', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  admin.connect();
  await waitFor(() => admin.status === 'online' && admin.isAdmin, 'admin online');
  const p: Record<string, MessengerClient> = {};
  for (const name of ['asha', 'bina']) {
    await admin.createEmployee(name, 'temp-password-1');
    p[name] = await device();
    await p[name].login(url, name, 'temp-password-1', `${name}-own-secret`);
    p[name].connect();
    await waitFor(() => p[name]!.status === 'online', `${name} online`);
  }
  const { asha, bina } = p as Record<string, MessengerClient>;

  // Asha builds her catalog.
  const chair = await asha!.createProduct({
    name: 'Office chair',
    price: '₹4,999',
    description: 'Ergonomic, adjustable height',
    photo: { mime: 'image/png', data: toBase64(PNG) },
  });
  await asha!.createProduct({ name: 'Desk lamp', price: '₹899' });
  assert.equal(chair.owner, 'asha');
  await assert.rejects(asha!.createProduct({ name: '  ' }), /needs a name/);
  await assert.rejects(asha!.createProduct({ name: 'Bad photo', photo: { mime: 'image/png', data: toBase64(new Uint8Array([1, 2, 3])) } }), /not a valid photo/);

  // Bina's own catalog is empty - she does NOT see Asha's products there.
  assert.deepEqual(await bina!.listProducts(), []);
  await bina!.createProduct({ name: 'Notebook', price: '₹120' });
  assert.deepEqual((await bina!.listProducts()).map((x) => x.name), ['Notebook']);
  assert.deepEqual((await asha!.listProducts()).map((x) => x.name), ['Desk lamp', 'Office chair']); // A-Z, mine only

  // Bina can open Asha's catalog from her profile (like WhatsApp), with photos.
  const ashas = await bina!.listProducts('asha');
  assert.deepEqual(ashas.map((x) => x.name), ['Desk lamp', 'Office chair']);
  const seen = ashas.find((x) => x.id === chair.id)!;
  assert.equal(await bina!.productPhoto(seen), `data:image/png;base64,${toBase64(PNG)}`);

  // ...but can't change or delete it.
  await assert.rejects(bina!.updateProduct(chair.id, { price: '₹1' }), /Not your product/);
  await assert.rejects(bina!.deleteProduct(chair.id), /Not your product/);

  // The owner changes it: only the fields sent; photo null removes it.
  const changed = await asha!.updateProduct(chair.id, { price: '₹4,499', photo: null });
  assert.equal(changed.price, '₹4,499');
  assert.equal(changed.name, 'Office chair');
  assert.equal(changed.photo, null);

  // Share into a chat: a card (snapshot) with name, price, description and whose catalog it is from.
  await asha!.sendProduct('bina', { id: changed.id, owner: 'asha', name: changed.name, price: changed.price, description: changed.description }, 'Shall we order 4?');
  await waitFor(() => !!bina!.getMessages('asha').at(-1)?.product, 'product card');
  const msg = bina!.getMessages('asha').at(-1)!;
  assert.deepEqual(msg.product, { id: chair.id, owner: 'asha', name: 'Office chair', price: '₹4,499', description: 'Ergonomic, adjustable height' });
  assert.equal(msg.text, 'Shall we order 4?');
  assert.equal(MessengerClient.preview(msg), '🛍️ Office chair');

  // An admin may remove anyone's product (moderation); deleting a user deletes their catalog.
  await admin.deleteProduct(chair.id);
  assert.deepEqual((await bina!.listProducts('asha')).map((x) => x.name), ['Desk lamp']);
  assert.ok((await admin.getAuditLog()).some((e) => e.action === 'catalog.delete'));
  await admin.removeEmployee('asha');
  assert.deepEqual(await bina!.listProducts('asha'), []);
});
