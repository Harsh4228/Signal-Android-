import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, createSign, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { PushKind } from '@meetme/core';
import type { PushSender } from './push';

/**
 * Wake-ups for the iPhone app, sent to Apple (APNs) directly: no Firebase needed. Same rule as push.ts:
 * a push only says "New message" or rings for "Incoming call", never who or what.
 *
 * The app registers `apns:{"e":"p"|"s","a":"<alert token>","v":"<VoIP token>"}` (see apps/mobile/src/push.ts).
 * Calls go to the VoIP token: iOS then shows its own call screen (CallKit), even when the app was closed.
 */
export const APNS_PREFIX = 'apns:';

interface AppleTokens {
  /** p = production (TestFlight / App Store), s = sandbox (a debug build from Xcode). */
  e: 'p' | 's';
  a: string;
  v: string;
}

const HEX_TOKEN = /^[0-9a-f]{32,200}$/;

export function parseAppleToken(token: string): AppleTokens | null {
  if (!token.startsWith(APNS_PREFIX)) return null;
  try {
    const t = JSON.parse(token.slice(APNS_PREFIX.length)) as Partial<AppleTokens>;
    if (t.e !== 'p' && t.e !== 's') return null;
    const a = typeof t.a === 'string' ? t.a : '';
    const v = typeof t.v === 'string' ? t.v : '';
    if (!a && !v) return null;
    if ((a && !HEX_TOKEN.test(a)) || (v && !HEX_TOKEN.test(v))) return null;
    return { e: t.e, a, v };
  } catch {
    return null;
  }
}

export class ApnsSender implements PushSender {
  private readonly key: KeyObject;
  private jwt: { value: string; at: number } | null = null;
  private sessions = new Map<string, ClientHttp2Session>();

  constructor(
    keyPem: string,
    private readonly keyId: string,
    private readonly teamId: string,
    /** The app's bundle id. */
    private readonly topic: string,
    /** Tests: a local server instead of Apple's. */
    private readonly opts: { origin?: string } = {},
  ) {
    this.key = createPrivateKey(keyPem);
  }

  /** APNS_KEY_FILE (the AuthKey_XXXX.p8 from developer.apple.com > Keys), APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC. */
  static fromEnv(env = process.env): ApnsSender | null {
    const file = env.APNS_KEY_FILE;
    if (!file || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) return null;
    if (!existsSync(file)) {
      console.warn(`iPhone push is off: ${file} not found`);
      return null;
    }
    return new ApnsSender(readFileSync(file, 'utf8'), env.APNS_KEY_ID, env.APNS_TEAM_ID, env.APNS_TOPIC || 'com.gosite.cellmate');
  }

  /** Provider token (ES256 JWT). Apple wants it renewed between 20 and 60 minutes. */
  private token(): string {
    if (this.jwt && Date.now() - this.jwt.at < 40 * 60_000) return this.jwt.value;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = `${b64({ alg: 'ES256', kid: this.keyId })}.${b64({ iss: this.teamId, iat: Math.floor(Date.now() / 1000) })}`;
    const sig = createSign('SHA256').update(head).sign({ key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.jwt = { value: `${head}.${sig}`, at: Date.now() };
    return this.jwt.value;
  }

  private session(host: string): ClientHttp2Session {
    const open = this.sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const s = connect(this.opts.origin ?? `https://${host}`);
    s.on('error', () => s.destroy());
    s.on('close', () => this.sessions.get(host) === s && this.sessions.delete(host));
    s.on('goaway', () => s.close());
    // Idle connections are fine to keep; don't keep the server process alive for them.
    s.unref();
    this.sessions.set(host, s);
    return s;
  }

  private post(host: string, token: string, headers: Record<string, string>, body: object): Promise<{ status: number; reason: string }> {
    return new Promise((resolve, reject) => {
      const req = this.session(host).request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
        authorization: `bearer ${this.token()}`,
        ...headers,
      });
      let status = 0;
      let text = '';
      req.setTimeout(10_000, () => req.close(constants.NGHTTP2_CANCEL));
      req.on('response', (h) => (status = Number(h[constants.HTTP2_HEADER_STATUS])));
      req.setEncoding('utf8');
      req.on('data', (d: string) => (text += d));
      req.on('end', () => {
        let reason = '';
        try {
          reason = text ? String((JSON.parse(text) as { reason?: string }).reason ?? '') : '';
        } catch {
          /* not JSON */
        }
        resolve({ status, reason });
      });
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  async send(stored: string, kind: PushKind): Promise<'ok' | 'invalid' | 'error'> {
    const t = parseAppleToken(stored);
    if (!t) return 'invalid';
    const host = t.e === 's' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    const now = Math.floor(Date.now() / 1000);
    const call = kind === 'call' && !!t.v;
    if (!call && !t.a) return 'ok'; // notifications not allowed on that phone
    const [token, headers, body] = call
      ? ([
          t.v,
          { 'apns-topic': `${this.topic}.voip`, 'apns-push-type': 'voip', 'apns-priority': '10', 'apns-expiration': String(now + 45) },
          { aps: {}, t: 'call' },
        ] as const)
      : ([
          t.a,
          {
            'apns-topic': this.topic,
            'apns-push-type': 'alert',
            'apns-priority': '10',
            'apns-collapse-id': kind === 'call' ? 'meetme-call' : 'meetme-message',
            'apns-expiration': String(now + (kind === 'call' ? 45 : 86400)),
          },
          {
            aps: {
              alert: { title: 'CellMate', body: kind === 'call' ? 'Incoming call' : 'New message' },
              sound: 'default',
              badge: 1,
              'thread-id': 'meetme',
              'interruption-level': kind === 'call' ? 'time-sensitive' : 'active',
            },
          },
        ] as const);
    try {
      const r = await this.post(host, token, headers, body);
      if (r.status === 200) return 'ok';
      if (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered' || r.reason === 'DeviceTokenNotForTopic') return 'invalid';
      if (r.reason === 'ExpiredProviderToken' || r.reason === 'InvalidProviderToken') this.jwt = null;
      console.error(`APNs send failed: ${r.status} ${r.reason}`);
      return 'error';
    } catch (e) {
      this.sessions.get(host)?.destroy();
      console.error('APNs send failed', e);
      return 'error';
    }
  }

  close(): void {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}
