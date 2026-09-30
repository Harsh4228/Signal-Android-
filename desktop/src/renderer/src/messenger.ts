import { useEffect, useReducer } from 'react';
import { CallManager, MessengerClient, type CallState } from '@meetme/core';

/** One client + call manager for the whole app. */
export const client = new MessengerClient(window.meetme.store);

export const calls = new CallManager(client, {
  RTCPeerConnection: window.RTCPeerConnection,
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c as MediaStreamConstraints),
});

/** Re-render whenever the client state changes. */
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
