import { bytesToHex } from '@noble/hashes/utils';
import { MAX_GROUP_CALL } from './api';
import type { WebRTCImpl } from './call';
import { groupIdOf, groupKey, type GroupCallSignal, type MessengerClient } from './client';
import { randomBytes } from './crypto/primitives';
import { Emitter } from './emitter';

/**
 * Group calls (voice or video) for up to MAX_GROUP_CALL people, as a mesh: everyone has one connection to every other
 * participant. All signalling goes through the end-to-end encrypted sessions, like 1:1 calls, so the server never
 * sees the keys; media is relayed through TURN when it is configured.
 *
 * Joining: whoever starts the call invites the group. Someone who joins tells every member already in it ("join",
 * with the list); between any two participants the one whose username sorts first makes the offer, so two people
 * never both offer at once.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type GroupCallStatus = 'idle' | 'ringing' | 'joining' | 'active';

export interface Participant {
  username: string;
  stream: any | null;
  connected: boolean;
  muted: boolean;
  cameraOff: boolean;
}

export interface GroupCallState {
  status: GroupCallStatus;
  /** Chat key of the group ("#<id>"). */
  group: string | null;
  callId: string | null;
  video: boolean;
  /** Who invited me (ringing). */
  from: string | null;
  localStream: any | null;
  muted: boolean;
  cameraOff: boolean;
  participants: Participant[];
  startedAt: number | null;
  endReason: string | null;
}

const RING_MS = 45_000;

const idle = (endReason: string | null = null): GroupCallState => ({
  status: 'idle',
  group: null,
  callId: null,
  video: false,
  from: null,
  localStream: null,
  muted: false,
  cameraOff: false,
  participants: [],
  startedAt: null,
  endReason,
});

interface Peer {
  pc: any;
  remoteSet: boolean;
  pending: NonNullable<GroupCallSignal['candidate']>[];
}

export class GroupCallManager extends Emitter<{ change: [GroupCallState] }> {
  state: GroupCallState = idle();
  private peers = new Map<string, Peer>();
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  /** The invite list while ringing (who was in the call then). */
  private invitedWith: string[] = [];

  constructor(
    private readonly client: MessengerClient,
    private readonly rtc: WebRTCImpl,
    /** True while a 1:1 call runs (then a group call can't start / is declined as busy). */
    private readonly busyElsewhere: () => boolean = () => false,
  ) {
    super();
    client.on('groupCallSignal', (from, s) => void this.onSignal(from, s).catch((e) => console.warn('group call signal failed', e)));
  }

  private set(patch: Partial<GroupCallState>) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  private get me() {
    return this.client.account?.username ?? '';
  }

  private send(to: string, s: Omit<GroupCallSignal, 'k' | 'callId' | 'g'>) {
    const { callId, group } = this.state;
    if (!callId || !group) return Promise.resolve();
    return this.client.sendCallSignal(to, { k: 'gcall', callId, g: groupIdOf(group), ...s } as GroupCallSignal).catch(() => {});
  }

  private inCall(): string[] {
    return this.state.participants.map((p) => p.username);
  }

  private upsert(username: string, patch: Partial<Participant> = {}) {
    const list = [...this.state.participants];
    const i = list.findIndex((p) => p.username === username);
    if (i < 0) list.push({ username, stream: null, connected: false, muted: false, cameraOff: false, ...patch });
    else list[i] = { ...list[i]!, ...patch };
    this.set({ participants: list });
  }

  /** Start a group call: everyone in the group is invited. */
  async start(group: string, video: boolean): Promise<void> {
    if (this.state.status !== 'idle' || this.busyElsewhere()) throw new Error('Already in a call');
    const g = this.client.groupOf(group);
    if (!g) throw new Error('You are not in this group');
    if (!this.client.can(video ? 'videoCall' : 'voiceCall', group)) throw new Error(`Your admin has turned off ${video ? 'video' : 'voice'} calls`);
    const others = g.members.filter((u) => u !== this.me);
    if (!others.length) throw new Error('Nobody else is in this group');
    if (g.members.length > MAX_GROUP_CALL) throw new Error(`Group calls are for up to ${MAX_GROUP_CALL} people`);
    this.set({ ...idle(), status: 'active', group, callId: bytesToHex(randomBytes(16)), video, startedAt: Date.now() });
    await this.openMedia(video);
    for (const u of others) void this.send(u, { action: 'invite', video, members: [this.me] });
  }

  /** Answer an invite (or join a call that is running in the group). */
  async join(): Promise<void> {
    if (this.state.status !== 'ringing') return;
    this.clearRing();
    this.set({ status: 'joining' });
    await this.openMedia(this.state.video);
    this.set({ status: 'active', startedAt: Date.now() });
    // Tell everyone in the group: those in the call connect to me (the lower username offers).
    const members = this.client.groupOf(this.state.group!)?.members.filter((u) => u !== this.me) ?? [];
    for (const u of members) void this.send(u, { action: 'join', members: [this.me] });
    for (const u of this.invitedWith) if (u !== this.me) this.connectTo(u);
  }

  async decline(): Promise<void> {
    if (this.state.status !== 'ringing') return;
    if (this.state.from) void this.send(this.state.from, { action: 'decline' });
    this.end('Declined');
  }

  async leave(): Promise<void> {
    if (this.state.status === 'idle') return;
    if (this.state.status === 'ringing') return this.decline();
    for (const u of this.inCall()) void this.send(u, { action: 'leave' });
    this.end('You left the call');
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    this.state.localStream?.getAudioTracks().forEach((t: any) => (t.enabled = !muted));
    this.set({ muted });
    this.sendMedia();
  }

  toggleCamera(): void {
    const tracks = this.state.localStream?.getVideoTracks() ?? [];
    if (!tracks.length) return;
    const cameraOff = !this.state.cameraOff;
    tracks.forEach((t: any) => (t.enabled = !cameraOff));
    this.set({ cameraOff });
    this.sendMedia();
  }

  switchCamera(): void {
    this.state.localStream?.getVideoTracks().forEach((t: any) => t._switchCamera?.());
  }

  private sendMedia() {
    for (const u of this.inCall()) void this.send(u, { action: 'media', muted: this.state.muted, cameraOff: this.state.cameraOff });
  }

  private async openMedia(video: boolean) {
    const stream = await this.rtc.getUserMedia({
      audio: true,
      video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
    });
    this.set({ localStream: stream });
  }

  /** Make sure there is a connection to this participant (I offer if my username sorts first). */
  private connectTo(user: string) {
    if (user === this.me || this.state.status !== 'active') return;
    this.upsert(user);
    if (this.peers.has(user)) return;
    if (this.me < user) void this.offerTo(user).catch((e) => console.warn('group call offer failed', e));
  }

  private async newPeer(user: string): Promise<Peer> {
    const existing = this.peers.get(user);
    if (existing) return existing;
    const ice = await this.client.getIceConfig();
    const pc = new this.rtc.RTCPeerConnection({
      iceServers: ice.iceServers,
      iceTransportPolicy: ice.relayOnly ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    const peer: Peer = { pc, remoteSet: false, pending: [] };
    this.peers.set(user, peer);
    this.state.localStream?.getTracks().forEach((t: any) => pc.addTrack(t, this.state.localStream));
    pc.addEventListener('icecandidate', (e: any) => {
      if (!e.candidate) return;
      const c = e.candidate;
      void this.send(user, { action: 'ice', candidate: { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } });
    });
    pc.addEventListener('track', (e: any) => {
      const stream = e.streams?.[0];
      if (stream) this.upsert(user, { stream });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.peers.get(user) !== peer) return;
      const st = pc.connectionState;
      if (st === 'connected') this.upsert(user, { connected: true });
      else if (st === 'failed' || st === 'closed') this.drop(user);
    });
    return peer;
  }

  private async offerTo(user: string) {
    const peer = await this.newPeer(user);
    const offer = await peer.pc.createOffer({});
    await peer.pc.setLocalDescription(offer);
    await this.send(user, { action: 'offer', sdp: offer.sdp, video: this.state.video });
  }

  private drop(user: string) {
    const peer = this.peers.get(user);
    this.peers.delete(user);
    try {
      peer?.pc.close();
    } catch {
      /* already closed */
    }
    this.set({ participants: this.state.participants.filter((p) => p.username !== user) });
    // Everyone else left: the call is over.
    if (this.state.status === 'active' && !this.state.participants.length && this.state.startedAt && Date.now() - this.state.startedAt > 3000) {
      this.end('Everyone left the call');
    }
  }

  private async onSignal(from: string, s: GroupCallSignal) {
    const key = groupKey(s.g);
    const same = this.state.callId === s.callId && this.state.group === key;
    switch (s.action) {
      case 'invite':
      case 'join': {
        if (same) {
          // Someone (else) joined my call: connect to them. If they offer (their name sorts first), tell them I'm here.
          if (this.state.status === 'active' && !this.peers.has(from)) {
            this.connectTo(from);
            if (!(this.me < from)) void this.send(from, { action: 'join', members: [this.me] });
          }
          return;
        }
        // Someone joined a call I'm not in: it is running there (the group chat offers "Join"), but it doesn't ring again.
        if (s.action === 'join') {
          this.noteOngoing(key, s.callId, !!s.video, from);
          return;
        }
        this.noteOngoing(key, s.callId, !!s.video, from);
        // An invite while I am in no call: it rings.
        if (this.state.status !== 'idle' || this.busyElsewhere()) {
          if (s.action === 'invite') void this.client.sendCallSignal(from, { k: 'gcall', callId: s.callId, g: s.g, action: 'decline' }).catch(() => {});
          return;
        }
        this.invitedWith = [...new Set([from, ...(Array.isArray(s.members) ? s.members.filter((u) => typeof u === 'string') : [])])];
        this.set({ ...idle(), status: 'ringing', group: key, callId: s.callId, video: !!s.video, from });
        this.ringTimer = setTimeout(() => this.state.status === 'ringing' && this.end('Missed group call'), RING_MS);
        return;
      }
      case 'offer': {
        if (!same || this.state.status !== 'active' || typeof s.sdp !== 'string') return;
        this.upsert(from);
        const peer = await this.newPeer(from);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
        peer.remoteSet = true;
        for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        await this.send(from, { action: 'answer', sdp: answer.sdp });
        return;
      }
      case 'answer': {
        const peer = this.peers.get(from);
        if (!same || !peer || typeof s.sdp !== 'string' || peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
        peer.remoteSet = true;
        for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
        return;
      }
      case 'ice': {
        const peer = this.peers.get(from);
        if (!same || !peer || !s.candidate) return;
        if (peer.remoteSet) await peer.pc.addIceCandidate(s.candidate).catch(() => {});
        else peer.pending.push(s.candidate);
        return;
      }
      case 'media':
        if (same) this.upsert(from, { muted: !!s.muted, cameraOff: !!s.cameraOff });
        return;
      case 'leave':
        this.leftOngoing(key, s.callId, from);
        if (same) this.drop(from);
        if (same && this.state.status === 'ringing' && from === this.state.from && !this.invitedWith.some((u) => u !== from)) {
          this.end('Missed group call');
        }
        return;
      case 'decline':
        return;
    }
  }

  // ---- calls running in my groups that I am not in (the chat shows "Join") ----
  private ongoing = new Map<string, { callId: string; video: boolean; members: Set<string>; until: number }>();

  private noteOngoing(group: string, callId: string, video: boolean, who: string) {
    const o = this.ongoing.get(group);
    if (o && o.callId === callId) o.members.add(who);
    else this.ongoing.set(group, { callId, video, members: new Set([who]), until: 0 });
    this.ongoing.get(group)!.until = Date.now() + 2 * 3600_000;
    this.emit('change', this.state);
  }

  private leftOngoing(group: string, callId: string, who: string) {
    const o = this.ongoing.get(group);
    if (!o || o.callId !== callId) return;
    o.members.delete(who);
    if (!o.members.size) this.ongoing.delete(group);
    this.emit('change', this.state);
  }

  /** A call is running in this group (and I'm not in it): who is in it. */
  ongoingIn(group: string): { video: boolean; members: string[] } | null {
    const o = this.ongoing.get(group);
    if (!o || o.until < Date.now() || (this.state.group === group && this.state.status === 'active')) return null;
    return { video: o.video, members: [...o.members] };
  }

  /** Join a call that is already running in this group. */
  async joinOngoing(group: string): Promise<void> {
    const o = this.ongoing.get(group);
    if (!o || this.state.status !== 'idle' || this.busyElsewhere()) return;
    this.invitedWith = [...o.members];
    this.set({ ...idle(), status: 'ringing', group, callId: o.callId, video: o.video, from: [...o.members][0] ?? null });
    await this.join();
  }

  private clearRing() {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
  }

  private end(reason: string) {
    const { group, video, startedAt, status } = this.state;
    if (group && status !== 'idle') {
      this.client.addCallLog(
        group,
        startedAt
          ? { video, outgoing: true, outcome: 'answered', durationSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)) }
          : { video, outgoing: false, outcome: reason === 'Declined' ? 'declined' : 'missed' },
      );
    }
    this.clearRing();
    for (const [, p] of this.peers) {
      try {
        p.pc.close();
      } catch {
        /* ignore */
      }
    }
    this.peers.clear();
    this.state.localStream?.getTracks().forEach((t: any) => t.stop());
    this.invitedWith = [];
    this.state = idle(reason);
    this.emit('change', this.state);
  }
}
