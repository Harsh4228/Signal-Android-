import { useEffect, useReducer } from 'react';
import { NativeModules, PermissionsAndroid, Platform, type Permission } from 'react-native';
import { mediaDevices, RTCPeerConnection } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import { AppLock, CallManager, MessengerClient, derivePin, fromBase64, toBase64, type CallState, type PinDerive } from '@meetme/core';
import { keychainStorage } from './storage';
import { mediaFiles } from './mediaFiles';

export const client = new MessengerClient(keychainStorage, { blobs: mediaFiles });

// Native PIN hashing where available (Android); the JavaScript fallback takes seconds on a phone.
const pinHash = NativeModules.PinHash as
  | { pbkdf2(pin: string, salt: string, iterations: number): Promise<string> }
  | undefined;
const nativeDerive: PinDerive | undefined = pinHash
  ? (pin, salt, iter) =>
      pinHash
        .pbkdf2(pin, toBase64(salt), iter)
        .then(fromBase64)
        .catch(() => derivePin(pin, salt, iter)) // Android 7 has no native PBKDF2-SHA256
  : undefined;

/** PIN / biometric lock. Its settings live in the same Keychain / Keystore storage. */
export const appLock = new AppLock(keychainStorage, Date.now, nativeDerive);

async function ensureMediaPermissions(video: boolean) {
  if (Platform.OS !== 'android') return; // iOS asks automatically using Info.plist texts
  const wanted: Permission[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (video) wanted.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  const res = await PermissionsAndroid.requestMultiple(wanted);
  if (wanted.some((p) => res[p] !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error('Camera/microphone permission denied');
  }
}

export const calls = new CallManager(client, {
  RTCPeerConnection: RTCPeerConnection as unknown as new (config: unknown) => unknown,
  async getUserMedia(constraints) {
    await ensureMediaPermissions(!!constraints.video);
    return mediaDevices.getUserMedia(constraints as never);
  },
});

// Route audio properly (earpiece vs speaker, proximity sensor, keep screen on) during calls.
let audioActive = false;
/** Loudspeaker (true) or earpiece (false). Video calls start on the speaker, voice calls on the earpiece. */
let speakerOn = false;
const speakerListeners = new Set<() => void>();

export function setSpeaker(on: boolean) {
  speakerOn = on;
  if (audioActive) InCallManager.setForceSpeakerphoneOn(on);
  speakerListeners.forEach((l) => l());
}

calls.on('change', (s) => {
  const inCall = s.status === 'connecting' || s.status === 'connected' || s.status === 'outgoing';
  if (inCall && !audioActive) {
    InCallManager.start({ media: s.video ? 'video' : 'audio' });
    audioActive = true;
    setSpeaker(s.video);
  } else if (s.status === 'idle' && audioActive) {
    InCallManager.stop();
    audioActive = false;
    setSpeaker(false);
  }
});

export function useSpeaker(): boolean {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    speakerListeners.add(bump);
    return () => void speakerListeners.delete(bump);
  }, []);
  return speakerOn;
}

export function useClient(): MessengerClient {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => client.on('change', bump), []);
  return client;
}

export function useCall(): CallState {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => calls.on('change', bump), []);
  return calls.state;
}

export function useLock(): AppLock {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => appLock.on('change', bump), []);
  return appLock;
}
