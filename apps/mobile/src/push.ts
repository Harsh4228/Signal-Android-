import { PermissionsAndroid, Platform } from 'react-native';
import { getApp } from '@react-native-firebase/app';
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import type { MessengerClient } from '@meetme/core';

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

export async function registerPush(client: MessengerClient): Promise<void> {
  if (registered) return;
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
    await client.setPushToken(await getToken(messaging));
    registered = true;
    offRefresh = onTokenRefresh(messaging, (token) => void client.setPushToken(token).catch(() => {}));
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
