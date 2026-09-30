import { useEffect, useReducer } from 'react';
import { PermissionsAndroid, Platform, type Permission } from 'react-native';
import { mediaDevices, RTCPeerConnection } from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';
import { CallManager, MessengerClient, type CallState } from '@meetme/core';
import { keychainStorage } from './storage';

export const client = new MessengerClient(keychainStorage);

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
calls.on('change', (s) => {
  const inCall = s.status === 'connecting' || s.status === 'connected' || s.status === 'outgoing';
  if (inCall && !audioActive) {
    InCallManager.start({ media: s.video ? 'video' : 'audio' });
    InCallManager.setForceSpeakerphoneOn(s.video);
    audioActive = true;
  } else if (s.status === 'idle' && audioActive) {
    InCallManager.stop();
    audioActive = false;
  }
});

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
