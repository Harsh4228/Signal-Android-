import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import { getApp } from '@react-native-firebase/app';
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import type { MessengerClient } from '@meetme/core';
import { nativeCallUi } from './callNotify';

/**
 * Wake-up pushes. The server sends a push only when a message is waiting and this phone is offline;
 * it just says "New message" / "Incoming call" (no sender, no text). Opening the app connects and
 * decrypts as usual, so nothing readable ever passes through Google or Apple.
 *
 * Needs a Firebase project (google-services.json / GoogleService-Info.plist). Without one this
 * quietly does nothing and the app works as before, just without notifications while closed.
 */
let registered = false;
let offRefresh: (() => void) | null = null;

/** iPhone: the server sends to Apple directly (ios/MeetMe/CallCenter.swift gets the two tokens). */
const Apple = NativeModules.ApplePush as
  | { getTokens(): Promise<{ granted: boolean; env: string; alert?: string; voip?: string }>; clearBadge(): void }
  | undefined;

/** Marks the token as Apple's: "New message" goes to `a`, incoming calls to the VoIP token `v`. */
export const APNS_PREFIX = 'apns:';

async function registerApple(client: MessengerClient): Promise<void> {
  const t = await Apple!.getTokens();
  if (!t.alert && !t.voip) return;
  const token = APNS_PREFIX + JSON.stringify({ e: t.env === 'sandbox' ? 's' : 'p', a: t.alert ?? '', v: t.voip ?? '' });
  await client.setPushToken(token);
  registered = true;
}

/** The notifications are only "New message": clear them once the app is open. */
export function clearNotifications(): void {
  Apple?.clearBadge();
}

export async function registerPush(client: MessengerClient): Promise<void> {
  if (registered) return;
  if (Platform.OS === 'ios') {
    if (Apple) await registerApple(client).catch((e) => console.warn('push registration failed', e));
    return;
  }
  let messaging;
  try {
    messaging = getMessaging(getApp());
  } catch {
    return; // Firebase not configured in this build
  }
  try {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      if (r !== PermissionsAndroid.RESULTS.GRANTED) return;
    }
    const status = await requestPermission(messaging);
    if (status !== AuthorizationStatus.AUTHORIZED && status !== AuthorizationStatus.PROVISIONAL) return;
    await client.setPushToken(await getToken(messaging), { callUi: nativeCallUi });
    registered = true;
    offRefresh = onTokenRefresh(messaging, (token) => void client.setPushToken(token, { callUi: nativeCallUi }).catch(() => {}));
  } catch (e) {
    console.warn('push registration failed', e);
  }
}

/** After logout: the core client already told the server to stop pushing; stop listening too. */
export function resetPush(): void {
  offRefresh?.();
  offRefresh = null;
  registered = false;
}
