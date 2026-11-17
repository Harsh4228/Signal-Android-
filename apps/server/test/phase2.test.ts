import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { CallManager, MemoryStorage, MessengerClient, inviteCode, type WebRTCImpl } from '@meetme/core';
import { startTestServer } from './harness';

// Screen sharing in calls, video statuses and replies to a status, live location, and the storage overview.
let srv: Awaited<ReturnType<typeof startTestServer>>;
let url = '';
const clients: MessengerClient[] = [];

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

type Track = { kind: string; enabled: boolean; stopped?: boolean; onended?: (() => void) | null; readyState?: string; stop(): void };
const track = (kind: string): Track => ({
  kind,
  enabled: true,
  stop() {
    this.stopped = true;
  },
});
function stream(tracks: Track[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    addTrack: (t: Track) => tracks.push(t),
  };
}

class Sender {
  constructor(public track: Track | null) {}
  async replaceTrack(t: Track | null) {
    this.track = t;
  }
}

class FakePC {
  connectionState = 'new';
  signalingState = 'stable';
  senders: Sender[] = [];
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(type: string, fn: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  addTrack(t: Track) {
    const s = new Sender(t);
    this.senders.push(s);
    return s;
  }
  getSenders() {
    return this.senders;
  }
  async createOffer() {
    return { type: 'offer', sdp: 'v=0 offer' };
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
    for (const fn of this.listeners.connectionstatechange ?? []) fn({});
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

let admin: MessengerClient;
async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}
async function join(username: string) {
  const invite = await admin.inviteEmployee({ username, name: username });
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  await c.join(inviteCode(url, invite), `${username}-password`);
  return online(c);
}

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['admin'], openRegistration: false });
  url = srv.url;
  admin = new MessengerClient(new MemoryStorage());
  clients.push(admin);
  await admin.init();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
});

test('screen sharing in a voice call and in a video call; the other side is told', async () => {
  const a = await join('sara');
  const b = await join('tom');
  await a.addContact('tom');
  const pa: FakePC[] = [];
  const pb: FakePC[] = [];
  const ca = new CallManager(a, rtc(pa));
  const cb = new CallManager(b, rtc(pb));

  await ca.startCall('tom', false);
  await waitFor(() => cb.state.status === 'incoming', 'incoming');
  await cb.accept();
  await waitFor(() => ca.state.status === 'connecting', 'answered');
  pa.at(-1)!.state('connected');
  pb.at(-1)!.state('connected');

  // Voice call: sharing adds the screen as video.
  const screen = track('video');
  await ca.startScreenShare(screen);
  assert.equal(ca.state.sharing, true);
  assert.ok(pa.at(-1)!.senders.some((s) => s.track === screen));
  await waitFor(() => cb.state.peerSharing && cb.state.video && !cb.state.peerCameraOff, 'tom sees the screen');

  // Stopping (or the "stop sharing" bar of the system) takes it away again.
  screen.onended!();
  await waitFor(() => !ca.state.sharing, 'stopped');
  assert.ok(screen.stopped);
  assert.ok(!pa.at(-1)!.senders.some((s) => s.track === screen));
  await waitFor(() => !cb.state.peerSharing && cb.state.peerCameraOff, 'tom sees it stopped');

  // Video call: the screen replaces the camera, and the camera comes back afterwards.
  await ca.hangup();
  await waitFor(() => cb.state.status === 'idle', 'hung up');
  await ca.startCall('tom', true);
  await waitFor(() => cb.state.status === 'incoming', 'incoming again');
  await cb.accept();
  await waitFor(() => ca.state.status === 'connecting', 'answered again');
  pa.at(-1)!.state('connected');
  pb.at(-1)!.state('connected');
  const pc = pa.at(-1)!;
  const camera = pc.senders.find((s) => s.track?.kind === 'video')!.track!;
  const screen2 = track('video');
  await ca.startScreenShare(screen2);
  assert.equal(pc.senders.find((s) => s.track?.kind === 'video')!.track, screen2);
  await ca.stopScreenShare();
  assert.equal(pc.senders.find((s) => s.track?.kind === 'video')!.track, camera);
  await ca.hangup();
});

test('video status with a preview; replying to a status; storage overview', async () => {
  const a = await join('uma');
  const b = await join('vik');
  await a.addContact('vik');
  await b.addContact('uma');
  await a.sendText('vik', 'hi');
  await waitFor(() => b.getMessages('uma').length === 1, 'first message');

  const video = new Uint8Array(200_000).map((_, i) => i & 0xff);
  await a.postStatus({ photo: { name: 'clip.mp4', mime: 'video/mp4', data: video, thumb: '/9j/4AAQ' }, caption: 'site visit' });
  await waitFor(() => b.statusGroups().some((g) => g.user === 'uma'), 'status arrived');
  const st = b.statusGroups().find((g) => g.user === 'uma')!.items[0]!;
  assert.equal(st.photo?.mime, 'video/mp4');
  assert.equal(st.photo?.thumb, '/9j/4AAQ');
  assert.deepEqual(await b.statusPhoto(st), video);
  await assert.rejects(
    a.postStatus({ photo: { name: 'big.mp4', mime: 'video/mp4', data: new Uint8Array(17 * 1024 * 1024 + 1) } }),
    /up to 16 MB/,
  );

  // A reply is a private message quoting the status.
  await b.replyToStatus(st, 'Looks good!');
  await waitFor(() => a.getMessages('vik').some((m) => m.text === 'Looks good!'), 'reply arrived');
  const reply = a.getMessages('vik').find((m) => m.text === 'Looks good!')!;
  assert.equal(reply.replyTo?.from, 'uma');
  assert.match(reply.replyTo!.text, /Status · 🎥 Video: site visit/);

  // Storage: files kept per chat; a file in two chats counts once in the total.
  const photo = new Uint8Array(1_500_000).map((_, i) => (i * 7) & 0xff);
  await a.sendFile('vik', { name: 'big.png', mime: 'image/png', data: photo });
  await waitFor(() => a.storageUsage().chats.some((x) => x.chat === 'vik'), 'kept on the device');
  const u = a.storageUsage();
  assert.equal(u.chats[0]!.chat, 'vik');
  assert.ok(u.total >= photo.length);
  assert.equal(u.largest[0]!.name, 'big.png');
});

test('live location: moves for everyone in the chat, only from its sender, and stops', async () => {
  const a = await join('wes');
  const b = await join('xia');
  await a.addContact('xia');

  await assert.rejects(a.startLiveLocation('xia', { lat: 19.07, lng: 72.87 }, 7), /15 minutes, 1 hour or 8 hours/);
  await a.startLiveLocation('xia', { lat: 19.07, lng: 72.87, name: 'Office' }, 15);
  assert.equal(a.sharingLiveLocation, true);
  await waitFor(() => !!b.getMessages('wes').find((m) => m.location?.liveUntil), 'live location arrived');
  const theirs = () => b.getMessages('wes').find((m) => m.location?.liveUntil)!;
  const mine = a.getMessages('xia').find((m) => m.location?.liveUntil)!;
  assert.ok(a.isMyLiveShare(mine.id));
  assert.ok(theirs().location!.liveUntil! - Date.now() <= 15 * 60_000);

  // Within 30 s of the start nothing is sent (small server load)...
  await a.updateLiveLocation(19.08, 72.88);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(theirs().location!.lat, 19.07);
  // ...after that, a real move is passed on.
  (a as unknown as { liveShares: Map<string, { last?: { at: number } }> }).liveShares.get(mine.id)!.last!.at -= 31_000;
  await a.updateLiveLocation(19.08, 72.88);
  await waitFor(() => theirs().location!.lat === 19.08, 'moved for xia');
  assert.equal(theirs().location!.name, 'Office');

  // Someone else can't move it: xia sending an update for wes's message changes nothing on wes's side.
  await (b as unknown as { sendToChat(k: string, p: unknown): Promise<unknown> }).sendToChat('wes', { k: 'loc', id: mine.id, lat: 1, lng: 1 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(mine.location!.lat, 19.08);

  await a.stopLiveLocation(mine.id);
  assert.equal(a.sharingLiveLocation, false);
  await waitFor(() => theirs().location!.stopped === true, 'stopped for xia');
});
