import { createCipheriv, createECDH, createPrivateKey, createSign, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';
import type { PushKind } from '@meetme/core';
import type { PushSender } from './push';

/**
 * Web Push (RFC 8030 / 8291 / 8292) for the web app, e.g. an iPhone home-screen app: free, no Firebase or Apple
 * account. The server signs requests with its own VAPID key. The push only says "message" or "call" (encrypted
 * for the browser), never who or what; the app opens and decrypts the real message as usual.
 */
export const WEB_PUSH_PREFIX = 'webpush:';

/** What the browser gave us: where to push, and the keys to encrypt for it. */
interface Subscription {
  e: string;
  p: string;
  a: string;
}

export function parseSubscription(token: string): Subscription | null {
  if (!token.startsWith(WEB_PUSH_PREFIX)) return null;
  try {
    const s = JSON.parse(token.slice(WEB_PUSH_PREFIX.length)) as Partial<Subscription>;
    if (typeof s.e !== 'string' || !/^https:\/\/[^\s]+$/.test(s.e) || typeof s.p !== 'string' || typeof s.a !== 'string') return null;
    const p = Buffer.from(s.p, 'base64url');
    const a = Buffer.from(s.a, 'base64url');
    return p.length === 65 && a.length === 16 ? (s as Subscription) : null;
  } catch {
    return null;
  }
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (what the browser needs as applicationServerKey). */
  publicKey: string;
  /** PKCS#8 PEM. */
  privateKey: string;
}

export function newVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { publicKey: raw.toString('base64url'), privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() };
}

/** aes128gcm content encoding (RFC 8188 / 8291), one record. */
function encrypt(sub: Subscription, plaintext: Buffer): Buffer {
  const uaPublic = Buffer.from(sub.p, 'base64url');
  const authSecret = Buffer.from(sub.a, 'base64url');
  const ecdh = createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const secret = ecdh.computeSecret(uaPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, authSecret, info, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 = this is the last (only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export class WebPushSender implements PushSender {
  private readonly key: KeyObject;

  constructor(
    private readonly vapid: VapidKeys,
    /** Who runs this server (VAPID "sub"), e.g. its https address. */
    private readonly contact: string,
  ) {
    this.key = createPrivateKey(vapid.privateKey);
  }

  /** VAPID: a short-lived ES256 JWT for the push service of this endpoint. */
  private authorization(endpoint: string): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = `${b64({ typ: 'JWT', alg: 'ES256' })}.${b64({
      aud: new URL(endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: this.contact,
    })}`;
    const sig = createSign('SHA256').update(head).sign({ key: this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `vapid t=${head}.${sig}, k=${this.vapid.publicKey}`;
  }

  async send(token: string, kind: PushKind): Promise<'ok' | 'invalid' | 'error'> {
    const sub = parseSubscription(token);
    if (!sub) return 'invalid';
    try {
      const res = await fetch(sub.e, {
        method: 'POST',
        headers: {
          authorization: this.authorization(sub.e),
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          ttl: kind === 'call' ? '45' : '86400',
          urgency: 'high',
          // Same topic = a newer push replaces one still waiting.
          topic: kind === 'call' ? 'call' : 'message',
        },
        body: new Uint8Array(encrypt(sub, Buffer.from(JSON.stringify({ t: kind })))),
      });
      if (res.ok) return 'ok';
      if (res.status === 404 || res.status === 410) return 'invalid';
      console.error(`web push failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return 'error';
    } catch (e) {
      console.error('web push failed', e);
      return 'error';
    }
  }
}
