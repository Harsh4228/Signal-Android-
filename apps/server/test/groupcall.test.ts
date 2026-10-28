import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { GroupCallManager, MemoryStorage, MessengerClient, inviteCode, type WebRTCImpl } from '@meetme/core';
import { startTestServer } from './harness';

// Group calls: the starter rings the group; everyone who joins gets a connection to everyone else in the call.
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

type Track = { kind: string; enabled: boolean; stop(): void };
const track = (kind: string): Track => ({ kind, enabled: true, stop() {} });
const stream = (tracks: Track[]) => ({
  getTracks: () => tracks,
  getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
});

/** A peer connection that "connects" once both descriptions are set. */
class FakePC {
  connectionState = 'new';
  signalingState = 'stable';
  private remote = false;
  private local = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  private fire(type: string, e: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(e);
  }
  addTrack() {}
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' };
  }
  async createAnswer() {
    return { type: 'answer', sdp: 'v=0 answer' };
  }
  async setLocalDescription(d: { type: string }) {
    this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable';
    this.local = true;
    this.check();
  }
  async setRemoteDescription(d: { type: string }) {
    this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable';
    this.remote = true;
    this.check();
  }
  private check() {
    if (this.local && this.remote && this.connectionState !== 'connected') {
      setTimeout(() => {
        this.connectionState = 'connected';
        this.fire('track', { streams: [stream([track('audio')])] });
        this.fire('connectionstatechange', {});
      }, 10);
    }
  }
  async addIceCandidate() {}
  close() {}
}

const rtc: WebRTCImpl = {
  RTCPeerConnection: function () {
    return new FakePC();
  } as unknown as WebRTCImpl['RTCPeerConnection'],
  getUserMedia: async (c) => stream([...(c.audio ? [track('audio')] : []), ...(c.video ? [track('video')] : [])]),
};

async function device() {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  return c;
}
async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}

test('group call: rings the group, everyone who joins is connected to everyone, leaving and joining later', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  const join = async (username: string) => {
    const invite = await admin.inviteEmployee({ username, name: username });
    const c = await device();
    await c.join(inviteCode(url, invite), `${username}-password`);
    return online(c);
  };
  const [amy, bob, cat] = [await join('amy'), await join('bob'), await join('cat')];
  const g = await admin.createGroup('Standup', ['admin', 'amy', 'bob', 'cat']);
  const key = `#${g.id}`;
  for (const c of [amy, bob, cat]) await waitFor(() => !!c.groupOf(key), 'group loaded');

  const calls = Object.fromEntries([amy, bob, cat].map((c) => [c.account!.username, new GroupCallManager(c, rtc)])) as Record<string, GroupCallManager>;

  // Bob starts; Amy and Cat ring.
  await calls.bob!.start(key, false);
  await waitFor(() => calls.amy!.state.status === 'ringing' && calls.cat!.state.status === 'ringing', 'ringing');

  // Amy joins: Bob and Amy are connected.
  await calls.amy!.join();
  await waitFor(() => calls.bob!.state.participants.some((p) => p.username === 'amy' && p.connected), 'bob sees amy');
  await waitFor(() => calls.amy!.state.participants.some((p) => p.username === 'bob' && p.connected), 'amy sees bob');

  // Cat joins later: connected to both.
  await calls.cat!.join();
  await waitFor(() => ['amy', 'bob'].every((u) => calls.cat!.state.participants.some((p) => p.username === u && p.connected)), 'cat sees both');
  await waitFor(() => calls.amy!.state.participants.some((p) => p.username === 'cat' && p.connected), 'amy sees cat');

  // Mute shows on the others.
  calls.cat!.toggleMute();
  await waitFor(() => !!calls.bob!.state.participants.find((p) => p.username === 'cat')?.muted, 'cat muted');

  // Amy leaves: the others keep talking; the admin (not in it, no manager) can see nothing.
  await calls.amy!.leave();
  await waitFor(() => !calls.bob!.state.participants.some((p) => p.username === 'amy'), 'amy gone for bob');
  assert.equal(calls.bob!.state.status, 'active');
  assert.equal(calls.amy!.state.status, 'idle');
  // Amy can join the running call again from the group chat.
  await waitFor(() => !!calls.amy!.ongoingIn(key), 'amy sees the call is running');
  await calls.amy!.joinOngoing(key);
  await waitFor(() => calls.amy!.state.participants.filter((p) => p.connected).length === 2, 'amy back with both');

  for (const m of Object.values(calls)) await m.leave();
  // Each side wrote the call into the group chat.
  assert.ok(bob.getMessages(key).some((m) => m.call));
});
