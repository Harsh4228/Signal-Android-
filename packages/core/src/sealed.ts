import { concat, fromBase64, fromUtf8, toBase64, utf8 } from './encoding';
import {
  aeadDecrypt,
  aeadEncrypt,
  dh,
  generateKeyPair,
  hkdfSha256,
  identityDhPriv,
  identityDhPub,
  randomBytes,
  sha256,
  sign,
  verify,
  type IdentityKeyPair,
} from './crypto/primitives';

/**
 * Sealed sender: hides WHO sent a message from the server (it still sees who receives it).
 *
 * 1. The server signs a short-lived "sender certificate": this username owns this identity key.
 * 2. The sender wraps the normal end-to-end message in two layers that only the recipient can open:
 *    - ephemeral layer: ephemeral X25519 key + recipient identity key -> reveals the sender's identity key
 *    - static layer:    sender identity key + recipient identity key -> proves the sender holds that key,
 *                       and carries the certificate and the inner message
 * 3. The sealed blob is posted WITHOUT logging in, so the server never learns the sender.
 *
 * To stop strangers from flooding someone anonymously, a sealed send must present the recipient's
 * secret "delivery key", which people only share with their contacts inside encrypted messages.
 */

export interface SenderCertificate {
  /** username */
  u: string;
  /** base64 Ed25519 identity public key */
  ik: string;
  /** expiry, ms since epoch */
  exp: number;
  /** base64 Ed25519 signature by the server's certificate key */
  sig: string;
}

export const CERTIFICATE_TTL_MS = 24 * 3600 * 1000;
const CERT_PREFIX = 'MeetMe-SenderCert-v1';

const certBytes = (u: string, ik: string, exp: number) => utf8(JSON.stringify([CERT_PREFIX, u, ik, exp]));

/** Server side: sign a certificate for an authenticated user. */
export function issueCertificate(serverKey: IdentityKeyPair, u: string, ik: string, now = Date.now()): SenderCertificate {
  const exp = now + CERTIFICATE_TTL_MS;
  return { u, ik, exp, sig: toBase64(sign(serverKey.priv, certBytes(u, ik, exp))) };
}

export function verifyCertificate(serverPub: Uint8Array, c: SenderCertificate, now = Date.now()): boolean {
  if (!c || typeof c.u !== 'string' || typeof c.ik !== 'string' || typeof c.exp !== 'number' || typeof c.sig !== 'string') {
    return false;
  }
  if (c.exp < now) return false;
  try {
    return verify(serverPub, certBytes(c.u, c.ik, c.exp), fromBase64(c.sig));
  } catch {
    return false;
  }
}

/** A random secret that lets contacts send us sealed messages. The server only stores its hash. */
export const newDeliveryKey = (): string => toBase64(randomBytes(32));
export const deliveryKeyHash = (key: string): string => toBase64(sha256(fromBase64(key)));

// ---- sealing ----

interface SealedWire {
  v: 1;
  sealed: 1;
  /** ephemeral X25519 public key */
  e: string;
  /** ephemeral layer: sender identity key */
  s: string;
  /** static layer: { cert, body } */
  c: string;
}

function ephemeralKeys(ourEphPrivOrRecipientPriv: Uint8Array, theirPub: Uint8Array, ephPub: Uint8Array, recipientIk: Uint8Array) {
  const shared = dh(ourEphPrivOrRecipientPriv, theirPub);
  const okm = hkdfSha256(shared, concat(ephPub, recipientIk), 'MeetMe-Sealed-Ephemeral-v1', 64);
  return { chain: okm.subarray(0, 32), key: okm.subarray(32, 64) };
}

function staticKey(shared: Uint8Array, chain: Uint8Array, sealedSender: Uint8Array) {
  return hkdfSha256(concat(chain, shared), sealedSender, 'MeetMe-Sealed-Static-v1', 32);
}

export function sealMessage(
  sender: IdentityKeyPair,
  cert: SenderCertificate,
  recipientIdentityKey: Uint8Array,
  body: string,
): string {
  const recipientDh = identityDhPub(recipientIdentityKey);
  const eph = generateKeyPair();
  const e = ephemeralKeys(eph.priv, recipientDh, eph.pub, recipientIdentityKey);
  const s = aeadEncrypt(e.key, sender.pub, concat(eph.pub, recipientIdentityKey));
  const k = staticKey(dh(identityDhPriv(sender.priv), recipientDh), e.chain, s);
  const c = aeadEncrypt(k, utf8(JSON.stringify({ cert, body })), s);
  const wire: SealedWire = { v: 1, sealed: 1, e: toBase64(eph.pub), s: toBase64(s), c: toBase64(c) };
  return JSON.stringify(wire);
}

export const isSealed = (body: string): boolean => body.startsWith('{"v":1,"sealed":1');

/**
 * Open a sealed message. Throws if it was not made for us, was tampered with, or the certificate does
 * not belong to the key that actually sealed it. The certificate's signature is checked separately
 * with verifyCertificate (the caller knows the server key).
 */
export function unsealMessage(
  recipient: IdentityKeyPair,
  sealed: string,
): { cert: SenderCertificate; body: string; senderIdentityKey: Uint8Array } {
  const w = JSON.parse(sealed) as SealedWire;
  if (w.v !== 1 || w.sealed !== 1) throw new Error('not a sealed message');
  const ephPub = fromBase64(w.e);
  const sBytes = fromBase64(w.s);
  const ourDhPriv = identityDhPriv(recipient.priv);
  const e = ephemeralKeys(ourDhPriv, ephPub, ephPub, recipient.pub);
  const senderIdentityKey = aeadDecrypt(e.key, sBytes, concat(ephPub, recipient.pub));
  if (senderIdentityKey.length !== 32) throw new Error('bad sender key');
  const k = staticKey(dh(ourDhPriv, identityDhPub(senderIdentityKey)), e.chain, sBytes);
  const inner = JSON.parse(fromUtf8(aeadDecrypt(k, fromBase64(w.c), sBytes))) as { cert: SenderCertificate; body: string };
  if (!inner.cert || typeof inner.body !== 'string') throw new Error('bad sealed content');
  if (inner.cert.ik !== toBase64(senderIdentityKey)) throw new Error('certificate does not match the sealing key');
  return { cert: inner.cert, body: inner.body, senderIdentityKey };
}
