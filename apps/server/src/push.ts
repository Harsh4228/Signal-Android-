import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { PushKind } from '@meetme/core';

/**
 * Content-free wake-up pushes through Firebase Cloud Messaging (FCM delivers to Android directly and
 * to iPhones through Apple's APNs).
 *
 * A push only ever says "New message" or "Incoming call". It never contains the sender, the text or
 * anything encrypted, so Google and Apple learn only that *someone* sent this device *something*.
 * The app opens, connects to the CellMate server and decrypts as usual.
 */
export interface PushSender {
  /** 'invalid' = the token is no longer valid (app uninstalled / reinstalled) and should be forgotten. */
  send(token: string, kind: PushKind): Promise<'ok' | 'invalid' | 'error'>;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export class FcmSender implements PushSender {
  private accessToken: { value: string; until: number } | null = null;
  private readonly tokenUri: string;
  private readonly sendUrl: string;

  constructor(
    private readonly account: ServiceAccount,
    opts: { fcmBaseUrl?: string } = {},
  ) {
    if (!account.project_id || !account.client_email || !account.private_key) {
      throw new Error('FCM service account JSON is missing project_id, client_email or private_key');
    }
    this.tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
    this.sendUrl = `${opts.fcmBaseUrl ?? 'https://fcm.googleapis.com'}/v1/projects/${account.project_id}/messages:send`;
  }

  /** Reads the service account from FCM_SERVICE_ACCOUNT_FILE or FCM_SERVICE_ACCOUNT_JSON. Null when not configured. */
  static fromEnv(env = process.env): FcmSender | null {
    const file = env.FCM_SERVICE_ACCOUNT_FILE;
    if (!env.FCM_SERVICE_ACCOUNT_JSON && file && !existsSync(file)) {
      console.warn(`Push is off: ${file} not found (see README, "Push notifications")`);
      return null;
    }
    const json = env.FCM_SERVICE_ACCOUNT_JSON ?? (file && readFileSync(file, 'utf8'));
    return json ? new FcmSender(JSON.parse(json) as ServiceAccount) : null;
  }

  /** OAuth2 access token from a self-signed JWT (Google "service account" flow), cached ~55 minutes. */
  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.until > Date.now()) return this.accessToken.value;
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: this.tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    );
    const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.account.private_key).toString('base64url');
    const res = await fetch(this.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${header}.${claims}.${signature}`,
      }),
    });
    if (!res.ok) throw new Error(`FCM auth failed: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { access_token: string; expires_in?: number };
    this.accessToken = { value: j.access_token, until: Date.now() + Math.min(j.expires_in ?? 3600, 3300) * 1000 };
    return j.access_token;
  }

  async send(token: string, kind: PushKind): Promise<'ok' | 'invalid' | 'error'> {
    const call = kind === 'call';
    const body = call ? 'Incoming call' : 'New message';
    const message = {
      token,
      data: { t: kind },
      android: {
        priority: 'HIGH',
        ttl: call ? '45s' : '86400s',
        // Same tag = one notification that gets replaced, not a pile of them.
        notification: {
          title: 'CellMate',
          body,
          tag: call ? 'meetme-call' : 'meetme-message',
          channel_id: call ? 'calls' : 'messages',
          visibility: 'PRIVATE',
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
          'apns-collapse-id': call ? 'meetme-call' : 'meetme-message',
          'apns-expiration': String(Math.floor(Date.now() / 1000) + (call ? 45 : 86400)),
        },
        payload: {
          aps: {
            alert: { title: 'CellMate', body },
            sound: 'default',
            'thread-id': 'meetme',
            'interruption-level': call ? 'time-sensitive' : 'active',
          },
        },
      },
    };
    try {
      const res = await fetch(this.sendUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (res.ok) return 'ok';
      const text = await res.text();
      if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(text)) return 'invalid';
      if (res.status === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text)) return 'invalid';
      if (res.status === 401) this.accessToken = null;
      console.error(`FCM send failed: ${res.status} ${text.slice(0, 300)}`);
      return 'error';
    } catch (e) {
      console.error('FCM send failed', e);
      return 'error';
    }
  }
}
