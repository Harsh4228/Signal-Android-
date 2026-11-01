import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, clearKindOf, groupKey, type ChatMessage } from '@meetme/core';
import { startTestServer } from './harness';

// The admin clears chat history by age and kind: of a person (all their chats) or of a group (every member's
// device). Messages are end-to-end encrypted, so the apps carry it out. People add a second mobile and email.
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

const texts = (c: MessengerClient, key: string) => c.getMessages(key).filter((m) => !m.system && !m.call).map((m) => m.text);

test('message kinds', () => {
  const base = { id: '1', peer: 'x', text: '', ts: 0, outgoing: true } as ChatMessage;
  assert.equal(clearKindOf({ ...base, text: 'hi' }), 'text');
  assert.equal(clearKindOf({ ...base, call: { video: false, outgoing: true, outcome: 'answered' } as never }), 'calls');
  assert.equal(clearKindOf({ ...base, attachment: { kind: 'image', mime: 'image/jpeg' } as never }), 'photos');
  assert.equal(clearKindOf({ ...base, attachment: { kind: 'file', mime: 'video/mp4' } as never }), 'photos');
  assert.equal(clearKindOf({ ...base, attachment: { kind: 'audio', mime: 'audio/aac' } as never }), 'voice');
  assert.equal(clearKindOf({ ...base, attachment: { kind: 'pdf', mime: 'application/pdf' } as never }), 'files');
  assert.equal(clearKindOf({ ...base, system: true, text: 'Secure session reset.' }), 'other');
});

test('admin clears a person or a group by age and kind; a second mobile and email', async () => {
  const admin = await user('admin');
  await waitFor(() => admin.isAdmin, 'admin');
  const asha = await user('asha');
  const bina = await user('bina');
  await asha.addContact('bina');
  await bina.addContact('asha');

  // 1:1: bina writes to asha; asha also has a call in that chat.
  await bina.sendText('asha', 'hello asha');
  await waitFor(() => texts(asha, 'bina').includes('hello asha'), 'asha got it');
  asha.addCallLog('bina', { video: false, outgoing: false, outcome: 'answered', durationSec: 5 } as never);

  // Only older than a week: today's messages stay.
  await admin.adminClearHistory({ scope: 'user', target: 'asha', olderThanDays: 7, kinds: ['text', 'calls'] });
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(texts(asha, 'bina'), ['hello asha']);

  // Everything, only text: the text goes, the call stays; bina (not cleared) keeps her copy.
  await admin.adminClearHistory({ scope: 'user', target: 'asha', olderThanDays: 0, kinds: ['text'] });
  await waitFor(() => texts(asha, 'bina').length === 0, 'asha text cleared');
  assert.equal(asha.getMessages('bina').filter((m) => m.call).length, 1);
  assert.deepEqual(texts(bina, 'asha'), ['hello asha']);

  // A group: cleared on every member's device.
  const g = await admin.createGroup('Team', ['admin', 'asha', 'bina']);
  const key = groupKey(g.id);
  await waitFor(() => !!asha.groupOf(key) && !!bina.groupOf(key), 'group loaded');
  await asha.sendText(key, 'group hello');
  await waitFor(() => texts(bina, key).includes('group hello'), 'bina got the group message');
  await admin.adminClearHistory({ scope: 'group', target: g.id, olderThanDays: 0, kinds: ['text', 'photos', 'files', 'voice', 'calls', 'other'] });
  await waitFor(() => texts(bina, key).length === 0 && texts(asha, key).length === 0, 'group cleared for everyone');
  // New messages after the clear stay.
  await asha.sendText(key, 'after the clear');
  await waitFor(() => texts(bina, key).includes('after the clear'), 'new message arrives');

  // Only admins may order a clear; nonsense is refused.
  await assert.rejects(asha.adminClearHistory({ scope: 'user', target: 'bina', olderThanDays: 0, kinds: ['text'] }));
  await assert.rejects(admin.adminClearHistory({ scope: 'user', target: 'bina', olderThanDays: 0, kinds: [] }), /what to clear/);
  await assert.rejects(admin.adminClearHistory({ scope: 'group', target: 'ffffffffffffffff', olderThanDays: 0, kinds: ['text'] }), /not found/);

  // A second mobile and email: the person adds them (even on a company server), colleagues see them.
  await bina.setMyExtraContact({ phone2: '+91 99999 11111', email2: 'Bina.Home@Example.com' });
  await assert.rejects(bina.setMyExtraContact({ phone2: 'abc', email2: '' }), /Mobile number/);
  const chirag = await user('chirag'); // hasn't looked at bina's profile yet (profiles are cached for 5 minutes)
  chirag.profileOf('bina');
  await waitFor(() => chirag.profileOf('bina')?.phone2 === '+91 99999 11111', 'a colleague sees the second mobile');
  assert.equal(chirag.profileOf('bina')?.email2, 'bina.home@example.com');
  assert.equal((await admin.listAllUsers()).find((u) => u.username === 'bina')?.phone2, '+91 99999 11111');
});
