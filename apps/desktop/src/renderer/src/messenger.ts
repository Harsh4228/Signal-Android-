import { useEffect, useReducer } from 'react';
import { AppLock, CallManager, MessengerClient, type CallState } from '@meetme/core';
import { browserStore } from './browserStore';

// The dev renderer opened in a plain browser (no Electron preload) gets a per-tab store instead.
if (!window.meetme && import.meta.env.DEV) window.meetme = { platform: 'web', store: browserStore() };

/** One client + call manager for the whole app. */
export const client = new MessengerClient(window.meetme.store, { blobs: window.meetme.media });

// Dev only: a hot update here (or in @meetme/core) would build a second, never-initialised client
// whose sends fail with "not registered". Reload the whole window instead.
import.meta.hot?.accept(() => location.reload());

/** PIN lock, stored (hashed) in the same OS-encrypted store. */
export const appLock = new AppLock(window.meetme.store);

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

export function useLock(): AppLock {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => appLock.on('change', bump), []);
  return appLock;
}
