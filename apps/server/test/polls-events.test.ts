import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, groupKey, pollCounts } from '@meetme/core';
import { startTestServer } from './harness';

// Polls and events (like WhatsApp): end-to-end encrypted chat messages; votes and RSVPs reach everyone in the chat.
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

test('polls and events in a group: everyone sees votes and answers; bad votes and outsiders are ignored', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  admin.connect();
  await waitFor(() => admin.status === 'online' && admin.isAdmin, 'admin online');
  const p: Record<string, MessengerClient> = {};
  for (const name of ['asha', 'bina', 'chirag', 'dev']) {
    await admin.createEmployee(name, 'temp-password-1');
    p[name] = await device();
    await p[name].login(url, name, 'temp-password-1', `${name}-own-secret`);
    p[name].connect();
    await waitFor(() => p[name]!.status === 'online', `${name} online`);
  }
  const { asha, bina, chirag, dev } = p as Record<string, MessengerClient>;
  // Chirag may only read in this group, but can still vote (like WhatsApp).
  const g = await admin.createGroup('Team', ['admin', 'asha', 'bina', 'chirag'], ['asha', 'bina']);
  const key = groupKey(g.id);
  await waitFor(() => [asha, bina, chirag].every((c) => !!c!.groupOf(key)), 'group loaded');

  await assert.rejects(asha!.sendPoll(key, 'Lunch?', ['Pizza']), /2-12 different options/);
  await assert.rejects(asha!.sendPoll(key, 'Lunch?', ['Pizza', 'pizza']), /different options/);
  await assert.rejects(chirag!.sendPoll(key, 'Mine?', ['a', 'b']), /Only selected members/);

  await asha!.sendPoll(key, 'Lunch where?', ['Pizza', 'Thali', 'Salad']);
  const pollOf = (c: MessengerClient) => c.getMessages(key).find((m) => m.poll)!;
  await waitFor(() => [admin, bina, chirag].every((c) => !!pollOf(c)), 'poll arrives');
  assert.equal(MessengerClient.preview(pollOf(bina!)), '📊 Lunch where?');
  const id = pollOf(asha!).id;

  await bina!.votePoll(key, id, [1]);
  await chirag!.votePoll(key, id, [1]);
  await asha!.votePoll(key, id, [0]);
  for (const c of [admin, asha, bina, chirag]) {
    await waitFor(() => pollCounts(pollOf(c!).poll!).join() === '1,2,0', 'everyone sees the votes');
  }
  assert.deepEqual(pollOf(admin).poll!.votes.chirag, [1]);
  // Change and take back a vote.
  await bina!.votePoll(key, id, [2]);
  await chirag!.votePoll(key, id, []);
  await waitFor(() => pollCounts(pollOf(asha!).poll!).join() === '1,0,1', 'changed votes');
  assert.equal(pollOf(asha!).poll!.votes.chirag, undefined);
  // One option only, valid indexes only; enforced on the receiving side too.
  await assert.rejects(bina!.votePoll(key, id, [0, 1]), /Pick one option/);
  const raw = bina! as unknown as { sendToChat(k: string, p: unknown): Promise<unknown> };
  await raw.sendToChat(key, { k: 'vote', id, ch: [0, 2] });
  await raw.sendToChat(key, { k: 'vote', id, ch: [7] });
  // Dev isn't in the group: his vote is dropped.
  const d = dev! as unknown as { sendPayload(peer: string, p: unknown): Promise<void> };
  await d.sendPayload('asha', { k: 'vote', id, ch: [0], g: g.id });
  await bina!.sendText(key, 'after the bad votes');
  await dev!.sendText('asha', 'after the outsider vote');
  await waitFor(() => asha!.getMessages(key).some((m) => m.text === 'after the bad votes'), 'text after bad votes');
  await waitFor(() => asha!.getMessages('dev').some((m) => m.text === 'after the outsider vote'), 'text after outsider');
  assert.equal(pollCounts(pollOf(asha!).poll!).join(), '1,0,1');
  assert.equal(pollOf(asha!).poll!.votes.dev, undefined);

  // A poll that allows several answers.
  await bina!.sendPoll(key, 'Which days?', ['Mon', 'Tue', 'Wed'], true);
  const multiOf = (c: MessengerClient) => c.getMessages(key).find((m) => m.poll?.multi)!;
  await waitFor(() => !!multiOf(asha!), 'multi poll arrives');
  await asha!.votePoll(key, multiOf(asha!).id, [0, 2]);
  await waitFor(() => pollCounts(multiOf(bina!).poll!).join() === '1,0,1', 'multi vote');

  // Polls can't be edited, not even by an admin (who may edit normal messages).
  await admin.sendPoll(key, 'Admin poll', ['x', 'y']);
  const adminPoll = admin.getMessages(key).filter((m) => m.poll && m.outgoing).at(-1)!;
  await assert.rejects(admin.editMessage(key, adminPoll.id, 'changed'), /can't be edited/);

  // Events.
  const start = Date.UTC(2026, 10, 20, 10, 0);
  await assert.rejects(admin.sendEvent(key, { title: 'Bad', start, end: start - 1 }), /end after the start/);
  await admin.sendEvent(key, { title: 'Town hall', description: 'Quarterly update', start, end: start + 3600_000, place: 'Hall B' });
  const evOf = (c: MessengerClient) => c.getMessages(key).find((m) => m.event)!;
  await waitFor(() => [asha, bina, chirag].every((c) => !!evOf(c!)), 'event arrives');
  const ev = evOf(chirag!).event!;
  assert.equal(ev.title, 'Town hall');
  assert.equal(ev.place, 'Hall B');
  assert.equal(ev.start, start);
  assert.equal(MessengerClient.preview(evOf(bina!)), '📅 Town hall');
  await asha!.rsvpEvent(key, evOf(asha!).id, 'yes');
  await chirag!.rsvpEvent(key, evOf(chirag!).id, 'maybe');
  await bina!.rsvpEvent(key, evOf(bina!).id, 'no');
  await waitFor(() => Object.keys(evOf(admin).event!.rsvp).length === 3, 'answers reach the organiser');
  assert.deepEqual(evOf(admin).event!.rsvp, { asha: 'yes', chirag: 'maybe', bina: 'no' });
  await raw.sendToChat(key, { k: 'rsvp', id: evOf(bina!).id, r: 'perhaps' });
  await bina!.sendText(key, 'after the bad answer');
  await waitFor(() => admin.getMessages(key).some((m) => m.text === 'after the bad answer'), 'text after bad rsvp');
  assert.equal(evOf(admin).event!.rsvp.bina, 'no');
});

test('a poll in a 1:1 chat', async () => {
  const [a, b] = [clients[1]!, clients[2]!]; // asha, bina from the first test
  await a.sendPoll('bina', 'Coffee?', ['Yes', 'No']);
  await waitFor(() => b.getMessages('asha').some((m) => m.poll), 'poll in 1:1');
  const id = b.getMessages('asha').find((m) => m.poll)!.id;
  await b.votePoll('asha', id, [0]);
  await waitFor(() => a.getMessages('bina').find((m) => m.id === id)?.poll?.votes.bina?.[0] === 0, 'vote back');
});
