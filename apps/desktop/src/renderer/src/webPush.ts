import { client } from './messenger';

/**
 * Notifications for the web app (iPhone: only once it is on the home screen, iOS 16.4+). The browser makes a
 * push subscription for this server's key; the server sends "message" / "call" wake-ups to it (see sw.js).
 */
const isWeb = () => window.meetme.platform === 'web';

export function webPushSupported(): boolean {
  return isWeb() && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhone / iPad Safari: push only works from the home-screen app. */
export function needsHomeScreen(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export const webPushState = (): NotificationPermission | 'unsupported' => (webPushSupported() ? Notification.permission : 'unsupported');

function keyBytes(b64url: string): Uint8Array {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Subscribe and tell the server. `ask`: show the browser's permission question (needs a tap on iPhone). */
export async function enableWebPush(ask: boolean): Promise<boolean> {
  if (!webPushSupported() || !client.account) return false;
  if (Notification.permission === 'denied') return false;
  if (Notification.permission !== 'granted') {
    if (!ask) return false;
    if ((await Notification.requestPermission()) !== 'granted') return false;
  }
  const cfg = await client.getPublicConfig(client.account.serverUrl);
  if (!cfg.vapidKey) throw new Error('This server does not send web notifications yet');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = keyBytes(cfg.vapidKey);
  // A subscription for another server key can't be used: make a new one.
  const same = sub?.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === key[i]);
  if (sub && !same) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('The browser gave no push address');
  await client.setPushToken(`webpush:${JSON.stringify({ e: j.endpoint, p: j.keys.p256dh, a: j.keys.auth })}`);
  return true;
}