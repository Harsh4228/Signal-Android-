import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { CallManager, MemoryStorage, MessengerClient, callLogText, type CallLog, type WebRTCImpl } from '@meetme/core';
import { startTestServer } from './harness';

// Call entries in the chat (like WhatsApp): each side writes its own after the call ends.
let srv: Awaited<ReturnType<typeof startTestServer>>;
let url = '';
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: true });
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

/** Just enough of RTCPeerConnection for the call flow; `connect()` plays "media is flowing". */
class FakePC {
  connectionState = 'new';
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  addTrack() {}
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 fake offer' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 fake answer' };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}
  close() {}
  connect() {
    this.connectionState = 'connected';
    for (const fn of this.listeners.connectionstatechange ?? []) fn({});
  }
}

function rtc(pcs: FakePC[]): WebRTCImpl {
  const track = { stop() {}, enabled: true };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track], getVideoTracks: () => [track] };
  return {
    RTCPeerConnection: function () {
      const pc = new FakePC();
      pcs.push(pc);
      return pc;
    } as unknown as WebRTCImpl['RTCPeerConnection'],
    getUserMedia: async () => stream,
  };
}

async function user(name: string) {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  await c.register(url, name);
  c.connect();
  await waitFor(() => c.status === 'online', `${name} online`);
  const pcs: FakePC[] = [];
  return { c, calls: new CallManager(c, rtc(pcs)), pcs };
}

const logs = (c: MessengerClient, peer: string): CallLog[] =>
  c.getMessages(peer).flatMap((m) => (m.call ? [m.call] : []));

test('answered, declined, cancelled and missed calls each leave the right entry on both sides', async () => {
  const a = await user('caller');
  const b = await user('callee');
  await a.c.addContact('callee');

  // 1. Video call, answered, talked a moment, caller hangs up.
  await a.calls.startCall('callee', true);
  await waitFor(() => b.calls.state.status === 'incoming', 'ringing');
  await b.calls.accept();
  await waitFor(() => a.calls.state.status === 'connecting', 'answer reached caller');
  a.pcs.at(-1)!.connect();
  b.pcs.at(-1)!.connect();
  await new Promise((r) => setTimeout(r, 1100));
  await a.calls.hangup();
  await waitFor(() => b.calls.state.status === 'idle', 'callee hung up too');
  const [aAnswered] = logs(a.c, 'callee');
  const [bAnswered] = logs(b.c, 'caller');
  assert.equal(aAnswered!.outcome, 'answered');
  assert.equal(aAnswered!.outgoing, true);
  assert.equal(aAnswered!.video, true);
  assert.ok(aAnswered!.durationSec! >= 1);
  assert.deepEqual({ ...bAnswered, durationSec: 0 }, { video: true, outgoing: false, outcome: 'answered', durationSec: 0 });

  // 2. Voice call, the callee declines.
  await a.calls.startCall('callee', false);
  await waitFor(() => b.calls.state.status === 'incoming', 'ringing 2');
  await b.calls.reject();
  await waitFor(() => a.calls.state.status === 'idle', 'caller told');
  assert.deepEqual(logs(a.c, 'callee')[1], { video: false, outgoing: true, outcome: 'declined' });
  assert.deepEqual(logs(b.c, 'caller')[1], { video: false, outgoing: false, outcome: 'declined' });

  // 3. The caller gives up before it's answered: cancelled for them, missed for the callee.
  b.c.setActiveChat(null);
  await a.calls.startCall('callee', false);
  await waitFor(() => b.calls.state.status === 'incoming', 'ringing 3');
  await a.calls.hangup();
  await waitFor(() => b.calls.state.status === 'idle', 'ring stopped');
  assert.deepEqual(logs(a.c, 'callee')[2], { video: false, outgoing: true, outcome: 'cancelled' });
  assert.deepEqual(logs(b.c, 'caller')[2], { video: false, outgoing: false, outcome: 'missed' });
  assert.equal(b.c.getUnread('caller'), 1); // a missed call counts as unread

  // Entries are local notices: shown in the chat list preview, never answered with receipts.
  const last = b.c.lastMessage('caller')!;
  assert.equal(MessengerClient.preview(last), 'Missed voice call');
  assert.equal(last.system, true);
});

test('call entry wording', () => {
  assert.equal(callLogText({ video: true, outgoing: false, outcome: 'missed' }), 'Missed video call');
  assert.equal(callLogText({ video: false, outgoing: true, outcome: 'answered', durationSec: 135 }), 'Outgoing voice call · 2:15');
  assert.equal(callLogText({ video: true, outgoing: true, outcome: 'answered', durationSec: 3723 }), 'Outgoing video call · 1:02:03');
  assert.equal(callLogText({ video: false, outgoing: false, outcome: 'declined' }), 'Declined voice call');
  assert.equal(callLogText({ video: false, outgoing: true, outcome: 'no-answer' }), 'Outgoing voice call · no answer');
});
