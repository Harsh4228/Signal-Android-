import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { CallManager, MemoryStorage, MessengerClient, type WebRTCImpl } from '@meetme/core';
import { startTestServer } from './harness';

// WhatsApp-style call details: "Ringing…", the other person's mute / camera state, turning a voice call
// into a video call, and "Reconnecting…" when the network drops instead of ending the call.
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

type Track = { kind: string; enabled: boolean; stop(): void };
const track = (kind: string): Track => ({ kind, enabled: true, stop() {} });
function stream(tracks: Track[]) {
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    addTrack: (t: Track) => tracks.push(t),
  };
}

/** RTCPeerConnection with a real signaling state machine; `state()` plays network events. */
class FakePC {
  connectionState = 'new';
  signalingState = 'stable';
  offers = 0;
  iceRestarts = 0;
  added: Track[] = [];
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type: string, e: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(e);
  }
  addTrack(t: Track) {
    this.added.push(t);
  }
  async createOffer(opts: { iceRestart?: boolean } = {}) {
    this.offers++;
    if (opts.iceRestart) this.iceRestarts++;
    return { type: 'offer', sdp: `v=0 offer ${this.offers}` };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 answer' };
  }
  async setLocalDescription(d: { type: string }) {
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(d: { type: string }) {
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate() {}
  close() {}
  state(s: string) {
    this.connectionState = s;
    this.fire('connectionstatechange', {});
  }
}

function rtc(pcs: FakePC[]): WebRTCImpl {
  return {
    RTCPeerConnection: function () {
      const pc = new FakePC();
      pcs.push(pc);
      return pc;
    } as unknown as WebRTCImpl['RTCPeerConnection'],
    getUserMedia: async (c) => stream([...(c.audio ? [track('audio')] : []), ...(c.video ? [track('video')] : [])]),
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

test('ringing, mute shown to the other side, voice call turned into video, reconnect', async () => {
  const a = await user('anil');
  const b = await user('bina');
  await a.c.addContact('bina');

  // "Calling…" until Bina's phone rings, then "Ringing…".
  await a.calls.startCall('bina', false);
  assert.equal(a.calls.state.ringing, false);
  await waitFor(() => b.calls.state.status === 'incoming', 'incoming');
  await waitFor(() => a.calls.state.ringing, 'ringing shown to the caller');

  await b.calls.accept();
  await waitFor(() => a.calls.state.status === 'connecting', 'answered');
  const pa = a.pcs.at(-1)!;
  const pb = b.pcs.at(-1)!;
  pa.state('connected');
  pb.state('connected');
  assert.equal(a.calls.state.status, 'connected');

  // Bina mutes: Anil sees it.
  b.calls.toggleMute();
  await waitFor(() => a.calls.state.peerMuted, 'peer muted');
  b.calls.toggleMute();
  await waitFor(() => !a.calls.state.peerMuted, 'peer unmuted');

  // Anil turns his camera on in the voice call: a new offer goes to Bina, she answers, both see a video call.
  assert.equal(a.calls.state.video, false);
  a.calls.toggleCamera();
  await waitFor(() => b.calls.state.video, 'video call on the other side');
  assert.equal(b.calls.state.cameraOff, true); // her camera stays off until she turns it on
  await waitFor(() => pa.signalingState === 'stable', 'renegotiation answered');
  assert.equal(a.calls.state.video, true);
  assert.equal(a.calls.state.cameraOff, false);
  assert.ok(pa.added.some((t) => t.kind === 'video'), 'camera track added');
  await waitFor(() => !b.calls.state.peerCameraOff, 'peer camera on');

  // Network drop: the call stays up as "Reconnecting…", the caller restarts ICE, then it's back.
  pa.state('disconnected');
  pb.state('disconnected');
  assert.equal(a.calls.state.status, 'connected');
  assert.equal(a.calls.state.reconnecting, true);
  pa.state('failed');
  await waitFor(() => pa.iceRestarts === 1, 'ICE restart offer');
  await waitFor(() => pa.signalingState === 'stable', 'restart answered');
  pa.state('connected');
  pb.state('connected');
  assert.equal(a.calls.state.reconnecting, false);
  assert.equal(b.calls.state.reconnecting, false);

  await a.calls.hangup();
  await waitFor(() => b.calls.state.status === 'idle', 'hung up');
});
