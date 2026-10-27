import { bytesToHex } from '@noble/hashes/utils';
import type { CallLog, CallSignal, MessengerClient } from './client';
import { randomBytes } from './crypto/primitives';
import { Emitter } from './emitter';

/**
 * 1:1 audio/video calls over WebRTC.
 *
 * Security: all signaling (SDP offer/answer incl. DTLS fingerprints, ICE candidates) is sent through the
 * Double Ratchet session, so the server can't read or modify it. That makes the DTLS-SRTP media
 * encryption end-to-end. With a TURN server configured, media is relayed so peers never see each other's IP.
 *
 * The WebRTC implementation is injected: browser/Electron globals on desktop, react-native-webrtc on mobile.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface WebRTCImpl {
  RTCPeerConnection: new (config: any) => any;
  getUserMedia(constraints: { audio: boolean; video: boolean | object }): Promise<any>;
}

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected';

export interface CallState {
  status: CallStatus;
  peer: string | null;
  callId: string | null;
  video: boolean;
  localStream: any | null;
  remoteStream: any | null;
  muted: boolean;
  cameraOff: boolean;
  startedAt: number | null;
  endReason: string | null;
  /** Outgoing: the other phone is ringing ("Ringing…" instead of "Calling…"). */
  ringing: boolean;
  /** The connection dropped and is being restored ("Reconnecting…"). */
  reconnecting: boolean;
  /** What the other person did with their microphone / camera. */
  peerMuted: boolean;
  peerCameraOff: boolean;
}

const RING_TIMEOUT_MS = 45_000;
/** How long a lost connection may take to come back before the call ends. */
const RECONNECT_MS = 20_000;

const idle = (endReason: string | null = null): CallState => ({
  status: 'idle',
  peer: null,
  callId: null,
  video: false,
  localStream: null,
  remoteStream: null,
  muted: false,
  cameraOff: false,
  startedAt: null,
  endReason,
  ringing: false,
  reconnecting: false,
  peerMuted: false,
  peerCameraOff: false,
});

export class CallManager extends Emitter<{ change: [CallState] }> {
  state: CallState = idle();
  private pc: any = null;
  private pendingOffer: string | null = null;
  private pendingCandidates: NonNullable<CallSignal['candidate']>[] = [];
  private outgoingCandidates: NonNullable<CallSignal['candidate']>[] | null = null;
  private remoteDescriptionSet = false;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  /** I started the current call (for the call entry in the chat). */
  private outgoing = false;
  /** A renegotiation offer of mine is on its way (camera turned on, ICE restart). */
  private makingOffer = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly client: MessengerClient,
    private readonly rtc: WebRTCImpl,
  ) {
    super();
    client.on('callSignal', (from, s) => void this.onSignal(from, s).catch((e) => this.fail(e)));
  }

  private set(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }

  private send(signal: Omit<CallSignal, 'k' | 'callId'>, peer = this.state.peer!, callId = this.state.callId!) {
    return this.client.sendCallSignal(peer, { k: 'call', callId, ...signal } as CallSignal);
  }

  async startCall(peer: string, video: boolean): Promise<void> {
    if (this.state.status !== 'idle') throw new Error('Already in a call');
    const callId = bytesToHex(randomBytes(16));
    this.outgoingCandidates = [];
    this.outgoing = true;
    this.set({ ...idle(), status: 'outgoing', peer, callId, video });
    try {
      const pc = await this.createPeerConnection(video);
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      await this.send({ action: 'offer', video, sdp: offer.sdp });
      // ICE candidates gathered before the offer went out must not overtake it.
      const queued = this.outgoingCandidates ?? [];
      this.outgoingCandidates = null;
      for (const candidate of queued) this.send({ action: 'ice', candidate }).catch(() => {});
      this.ringTimer = setTimeout(() => void this.hangup('No answer'), RING_TIMEOUT_MS);
    } catch (e) {
      this.fail(e);
      throw e;
    }
  }

  async accept(): Promise<void> {
    if (this.state.status !== 'incoming' || !this.pendingOffer) return;
    this.clearRing();
    this.set({ status: 'connecting' });
    try {
      const pc = await this.createPeerConnection(this.state.video);
      await pc.setRemoteDescription({ type: 'offer', sdp: this.pendingOffer });
      this.remoteDescriptionSet = true;
      await this.flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.send({ action: 'answer', sdp: answer.sdp });
    } catch (e) {
      this.fail(e);
    }
  }

  async reject(): Promise<void> {
    if (this.state.status !== 'incoming') return;
    this.send({ action: 'reject' }).catch(() => {});
    this.cleanup('Declined');
  }

  async hangup(reason = 'Call ended'): Promise<void> {
    if (this.state.status === 'idle') return;
    this.send({ action: 'hangup' }).catch(() => {});
    this.cleanup(reason);
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    this.state.localStream?.getAudioTracks().forEach((t: any) => (t.enabled = !muted));
    this.set({ muted });
    this.sendMediaState();
  }

  /** Camera on/off. In a voice call (no camera yet) this turns the camera on and makes it a video call. */
  toggleCamera(): void {
    if (!this.state.localStream?.getVideoTracks().length) {
      void this.enableVideo().catch((e) => console.warn('could not turn the camera on', e));
      return;
    }
    const cameraOff = !this.state.cameraOff;
    this.state.localStream.getVideoTracks().forEach((t: any) => (t.enabled = !cameraOff));
    this.set({ cameraOff });
    this.sendMediaState();
  }

  private sendMediaState() {
    if (this.state.status !== 'connecting' && this.state.status !== 'connected') return;
    const cameraOff = this.state.cameraOff || !this.state.localStream?.getVideoTracks().length;
    this.send({ action: 'media', muted: this.state.muted, cameraOff }).catch(() => {});
  }

  /** Voice call -> video call: add a camera track and renegotiate. */
  private async enableVideo() {
    const pc = this.pc;
    if (!pc || this.state.status !== 'connected') return;
    const cam = await this.rtc.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
    const track = cam.getVideoTracks()[0];
    if (!track || this.pc !== pc) return track?.stop();
    const local = this.state.localStream;
    local?.addTrack?.(track);
    pc.addTrack(track, local ?? cam);
    this.set({ video: true, cameraOff: false, localStream: local ?? cam });
    await this.renegotiate();
    this.sendMediaState();
  }

  /** Send a new offer for the running call (new track, or iceRestart after a network change). */
  private async renegotiate(iceRestart = false) {
    const pc = this.pc;
    if (!pc) return;
    this.makingOffer = true;
    try {
      const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : {});
      if (this.pc !== pc) return;
      await pc.setLocalDescription(offer);
      await this.send({ action: 'reoffer', sdp: offer.sdp, video: this.state.video });
    } finally {
      this.makingOffer = false;
    }
  }

  /** Mobile only (react-native-webrtc): switch front/back camera. */
  switchCamera(): void {
    this.state.localStream?.getVideoTracks().forEach((t: any) => t._switchCamera?.());
  }

  private async onSignal(from: string, s: CallSignal) {
    const sameCall = this.state.callId === s.callId && this.state.peer === from;
    switch (s.action) {
      case 'offer':
        if (this.state.status !== 'idle') {
          if (!sameCall) this.send({ action: 'busy' }, from, s.callId).catch(() => {});
          return;
        }
        if (typeof s.sdp !== 'string') return;
        this.pendingOffer = s.sdp;
        this.pendingCandidates = [];
        this.remoteDescriptionSet = false;
        this.outgoing = false;
        this.set({ ...idle(), status: 'incoming', peer: from, callId: s.callId, video: !!s.video });
        this.ringTimer = setTimeout(() => this.cleanup('Missed call'), RING_TIMEOUT_MS);
        this.send({ action: 'ringing' }).catch(() => {});
        break;
      case 'ringing':
        if (sameCall && this.state.status === 'outgoing') this.set({ ringing: true });
        break;
      case 'reoffer': {
        if (!sameCall || !this.pc || typeof s.sdp !== 'string') return;
        // Both changed something at the same moment: the caller's offer wins, the callee answers it.
        const collision = this.makingOffer || this.pc.signalingState !== 'stable';
        if (collision && this.outgoing) return;
        await this.pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.send({ action: 'reanswer', sdp: answer.sdp });
        // They turned their camera on: it is a video call now (mine stays off until I turn it on).
        if (s.video && !this.state.video) this.set({ video: true, cameraOff: true });
        break;
      }
      case 'reanswer':
        if (!sameCall || !this.pc || typeof s.sdp !== 'string' || this.pc.signalingState !== 'have-local-offer') return;
        await this.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
        break;
      case 'media':
        if (sameCall) this.set({ peerMuted: !!s.muted, peerCameraOff: !!s.cameraOff });
        break;
      case 'answer':
        if (!sameCall || this.state.status !== 'outgoing' || typeof s.sdp !== 'string') return;
        this.clearRing();
        this.set({ status: 'connecting' });
        await this.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp });
        this.remoteDescriptionSet = true;
        await this.flushCandidates();
        break;
      case 'ice':
        if (!sameCall || !s.candidate) return;
        if (this.remoteDescriptionSet && this.pc) await this.pc.addIceCandidate(s.candidate);
        else this.pendingCandidates.push(s.candidate);
        break;
      case 'hangup':
        if (sameCall) this.cleanup(this.state.status === 'incoming' ? 'Missed call' : 'Call ended');
        break;
      case 'reject':
        if (sameCall) this.cleanup('Call declined');
        break;
      case 'busy':
        if (sameCall) this.cleanup('User is busy');
        break;
    }
  }

  private async createPeerConnection(video: boolean) {
    const ice = await this.client.getIceConfig();
    const pc = new this.rtc.RTCPeerConnection({
      iceServers: ice.iceServers,
      iceTransportPolicy: ice.relayOnly ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.pc = pc;
    const localStream = await this.rtc.getUserMedia({
      audio: true,
      video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    localStream.getTracks().forEach((t: any) => pc.addTrack(t, localStream));
    this.set({ localStream });

    pc.addEventListener('icecandidate', (e: any) => {
      if (!e.candidate) return;
      const c = e.candidate;
      const candidate = { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null };
      if (this.outgoingCandidates) this.outgoingCandidates.push(candidate);
      else this.send({ action: 'ice', candidate }).catch(() => {});
    });
    pc.addEventListener('track', (e: any) => {
      const stream = e.streams?.[0];
      // A camera track added later arrives on the same stream: set it again so the screen redraws.
      if (stream) this.set({ remoteStream: stream, ...(e.track?.kind === 'video' ? { video: true } : {}) });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') {
        this.clearReconnect();
        if (this.state.status !== 'connected') this.set({ status: 'connected', startedAt: Date.now() });
        else if (this.state.reconnecting) this.set({ reconnecting: false });
      } else if (st === 'failed' && this.state.status !== 'connected') {
        void this.hangup('Connection failed');
      } else if ((st === 'disconnected' || st === 'failed') && this.state.status === 'connected') {
        // Network change (Wi-Fi -> mobile data) or a short drop: keep the call and try to restore it.
        if (!this.state.reconnecting) this.set({ reconnecting: true });
        if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => void this.hangup('Connection lost'), RECONNECT_MS);
        if (st === 'failed' && this.outgoing) void this.renegotiate(true).catch(() => {});
      }
    });
    return pc;
  }

  private async flushCandidates() {
    const list = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => {});
  }

  private clearReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearRing() {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
  }

  private fail(e: unknown) {
    console.warn('call failed', e);
    if (this.state.status !== 'idle') void this.hangup(e instanceof Error ? e.message : 'Call failed');
  }

  /** What to write in the chat for the call that is ending (null = nothing to log). */
  private logFor(reason: string): CallLog | null {
    const { status, peer, video, startedAt } = this.state;
    if (status === 'idle' || !peer) return null;
    const outgoing = this.outgoing;
    if (startedAt) {
      return { video, outgoing, outcome: 'answered', durationSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)) };
    }
    if (!outgoing) {
      if (status === 'incoming') return { video, outgoing, outcome: reason === 'Declined' ? 'declined' : 'missed' };
      return { video, outgoing, outcome: 'failed' }; // accepted, but it never connected
    }
    const byReason: Record<string, CallLog['outcome']> = {
      'Call declined': 'declined',
      'No answer': 'no-answer',
      'User is busy': 'busy',
    };
    const outcome = byReason[reason] ?? (status === 'outgoing' && reason === 'Call ended' ? 'cancelled' : 'failed');
    return { video, outgoing, outcome };
  }

  private cleanup(reason: string) {
    const log = this.logFor(reason);
    const peer = this.state.peer;
    if (log && peer) this.client.addCallLog(peer, log);
    this.clearRing();
    this.clearReconnect();
    this.makingOffer = false;
    this.state.localStream?.getTracks().forEach((t: any) => t.stop());
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.pc = null;
    this.pendingOffer = null;
    this.pendingCandidates = [];
    this.outgoingCandidates = null;
    this.remoteDescriptionSet = false;
    this.state = idle(reason);
    this.emit('change', this.state);
  }
}
