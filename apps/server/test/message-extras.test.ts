import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, groupKey, mapsUrl, randomBytes } from '@meetme/core';
import { startTestServer } from './harness';

// WhatsApp-style extras: reply, reactions, contact cards, locations, forward, star, search, voice messages.
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

async function device(storage = new MemoryStorage()) {
  const c = new MessengerClient(storage);
  clients.push(c);
  await c.init();
  return c;
}

test('reply, react, contact card, location, forward, star, search and voice messages', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  admin.connect();
  await waitFor(() => admin.status === 'online' && admin.isAdmin, 'admin online');
  const store: Record<string, MemoryStorage> = {};
  const p: Record<string, MessengerClient> = {};
  for (const name of ['asha', 'bina', 'chirag']) {
    await admin.createEmployee(name, 'temp-password-1');
    store[name] = new MemoryStorage();
    p[name] = await device(store[name]);
    await p[name].login(url, name, 'temp-password-1', `${name}-own-secret`);
    p[name].connect();
    await waitFor(() => p[name]!.status === 'online', `${name} online`);
  }
  const { asha, bina, chirag } = p as Record<string, MessengerClient>;
  const last = (c: MessengerClient, chat: string) => c.getMessages(chat).at(-1)!;

  // Reply: the answer carries a snapshot of the message it answers.
  await asha!.sendText('bina', 'Can you send the invoice?');
  await waitFor(() => last(bina!, 'asha')?.text === 'Can you send the invoice?', 'question');
  await bina!.sendText('asha', 'Sending it now', { replyTo: last(bina!, 'asha') });
  await waitFor(() => last(asha!, 'bina')?.text === 'Sending it now', 'reply');
  assert.deepEqual(last(asha!, 'bina').replyTo, {
    id: asha!.getMessages('bina')[0]!.id,
    from: 'asha',
    text: 'Can you send the invoice?',
  });

  // Reactions in a group: everyone sees them; one per person; only the allowed set.
  const g = await admin.createGroup('Team', ['admin', 'asha', 'bina', 'chirag']);
  const key = groupKey(g.id);
  await waitFor(() => [asha, bina, chirag].every((c) => !!c!.groupOf(key)), 'group');
  await chirag!.sendText(key, 'Shipped the order!');
  await waitFor(() => [admin, asha, bina].every((c) => last(c!, key)?.text === 'Shipped the order!'), 'group msg');
  const id = last(asha!, key).id;
  await asha!.react(key, id, '👍');
  await bina!.react(key, id, '❤️');
  await bina!.react(key, id, '😂'); // replaces bina's ❤️
  await waitFor(() => JSON.stringify(last(chirag!, key).reactions) === JSON.stringify({ asha: '👍', bina: '😂' }), 'reactions');
  await asha!.react(key, id, null);
  await waitFor(() => !last(admin, key).reactions?.asha, 'reaction removed');
  await assert.rejects(asha!.react(key, id, '💩'), /Unknown reaction/);
  const raw = bina! as unknown as { sendToChat(k: string, p: unknown): Promise<unknown> };
  await raw.sendToChat(key, { k: 'react', id, e: '💩' });
  await bina!.sendText(key, 'after the bad reaction');
  await waitFor(() => last(chirag!, key).text === 'after the bad reaction', 'after bad reaction');
  assert.equal(chirag!.getMessages(key).find((m) => m.id === id)!.reactions?.bina, '😂');

  // Contact card and location.
  await asha!.sendContact('bina', 'chirag');
  await waitFor(() => last(bina!, 'asha')?.contact === 'chirag', 'contact card');
  assert.equal(MessengerClient.preview(last(bina!, 'asha')), '👤 chirag');
  await assert.rejects(asha!.sendContact('bina', 'nobody_here'), /User not found/);
  await asha!.sendLocation('bina', { lat: 19.0760, lng: 72.8777, name: 'Mumbai office' });
  await waitFor(() => !!last(bina!, 'asha')?.location, 'location');
  const loc = last(bina!, 'asha').location!;
  assert.deepEqual(loc, { lat: 19.076, lng: 72.8777, name: 'Mumbai office' });
  assert.equal(mapsUrl(loc), 'https://www.google.com/maps/search/?api=1&query=19.076000,72.877700');
  await assert.rejects(asha!.sendLocation('bina', { lat: 123, lng: 0 }), /Invalid location/);

  // Voice message: an audio attachment.
  const voice = randomBytes(3000);
  await asha!.sendFile('bina', { name: 'voice.webm', mime: 'audio/webm', data: voice });
  await waitFor(() => last(bina!, 'asha')?.attachment?.state === 'ready', 'voice arrives');
  assert.equal(last(bina!, 'asha').attachment!.kind, 'audio');
  assert.equal(MessengerClient.preview(last(bina!, 'asha')), '🎤 Voice message');
  const voiceMsg = last(bina!, 'asha');

  // Forward: to another chat, freshly encrypted, marked Forwarded.
  await bina!.forwardMessage('chirag', voiceMsg);
  await bina!.forwardMessage('chirag', bina!.getMessages('asha').find((m) => m.location)!);
  await waitFor(() => chirag!.getMessages('bina').filter((m) => m.forwarded).length === 2, 'forwards');
  const fwdVoice = chirag!.getMessages('bina').find((m) => m.attachment)!;
  await waitFor(() => fwdVoice.attachment?.state === 'ready', 'forwarded file decrypted');
  assert.deepEqual(fwdVoice.attachment!.data, voice);
  assert.equal(chirag!.getMessages('bina').find((m) => m.location)!.location!.name, 'Mumbai office');
  await assert.rejects(bina!.forwardMessage('chirag', { ...voiceMsg, poll: { question: 'q', options: ['a', 'b'], multi: false, votes: {} } }), /can't be forwarded/);

  // Search inside a chat.
  assert.deepEqual(bina!.searchMessages('asha', 'INVOICE').map((m) => m.text), ['Can you send the invoice?']);
  assert.equal(bina!.searchMessages('asha', 'mumbai').length, 1);
  assert.equal(bina!.searchMessages('asha', '.webm').length, 1); // finds the file name
  assert.deepEqual(bina!.searchMessages('asha', ''), []);

  // Star: listed after a restart; deleting the message removes the star.
  const question = bina!.getMessages('asha')[0]!;
  bina!.toggleStar(question);
  bina!.toggleStar(last(bina!, 'asha'));
  assert.equal(bina!.starredMessages().length, 2);
  bina!.toggleStar(last(bina!, 'asha')); // unstar
  assert.deepEqual(bina!.starredMessages().map((s) => s.preview), ['Can you send the invoice?']);
  bina!.dispose();
  const bina2 = await device(store.bina);
  assert.deepEqual(bina2.starredMessages().map((s) => [s.chat, s.from, s.preview]), [['asha', 'asha', 'Can you send the invoice?']]);
});
