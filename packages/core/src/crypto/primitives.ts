import { ed25519, x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256, sha512 } from '@noble/hashes/sha2';
import { randomBytes as nobleRandomBytes } from '@noble/hashes/utils';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { concat, utf8 } from '../encoding';

/**
 * Crypto primitives. All of them come from the audited, pure-JS @noble libraries so the exact same
 * code runs in Node (server/tests), Electron and React Native (needs crypto.getRandomValues polyfill).
 */

export interface KeyPair {
  pub: Uint8Array;
  priv: Uint8Array;
}

/** Long-term identity key: Ed25519 (signing). Converted to X25519 for Diffie-Hellman. */
export type IdentityKeyPair = KeyPair;

export const randomBytes = (n: number): Uint8Array => nobleRandomBytes(n);

export function generateIdentityKeyPair(): IdentityKeyPair {
  const priv = ed25519.utils.randomSecretKey();
  return { priv, pub: ed25519.getPublicKey(priv) };
}

export function generateKeyPair(): KeyPair {
  const priv = x25519.utils.randomSecretKey();
  return { priv, pub: x25519.getPublicKey(priv) };
}

export const identityDhPriv = (edPriv: Uint8Array): Uint8Array => ed25519.utils.toMontgomerySecret(edPriv);
export const identityDhPub = (edPub: Uint8Array): Uint8Array => ed25519.utils.toMontgomery(edPub);

export function dh(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  if (pub.length !== 32) throw new Error('bad public key length');
  const out = x25519.getSharedSecret(priv, pub);
  // Reject low-order points (all-zero shared secret).
  if (out.every((b) => b === 0)) throw new Error('invalid DH output');
  return out;
}

export const sign = (identityPriv: Uint8Array, msg: Uint8Array): Uint8Array => ed25519.sign(msg, identityPriv);

export function verify(identityPub: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  try {
    return ed25519.verify(sig, msg, identityPub);
  } catch {
    return false;
  }
}

export const hkdfSha256 = (ikm: Uint8Array, salt: Uint8Array, info: string, len: number): Uint8Array =>
  hkdf(sha256, ikm, salt, utf8(info), len);

export const hmacSha256 = (key: Uint8Array, data: Uint8Array): Uint8Array => hmac(sha256, key, data);

export { sha256, sha512 };

/** AEAD encryption with a single-use message key. Key and nonce are both derived from `mk`. */
export function aeadEncrypt(mk: Uint8Array, plaintext: Uint8Array, ad: Uint8Array): Uint8Array {
  const okm = hkdfSha256(mk, new Uint8Array(32), 'MeetMe-MessageKeys-v1', 56);
  return xchacha20poly1305(okm.subarray(0, 32), okm.subarray(32, 56), ad).encrypt(plaintext);
}

export function aeadDecrypt(mk: Uint8Array, ciphertext: Uint8Array, ad: Uint8Array): Uint8Array {
  const okm = hkdfSha256(mk, new Uint8Array(32), 'MeetMe-MessageKeys-v1', 56);
  return xchacha20poly1305(okm.subarray(0, 32), okm.subarray(32, 56), ad).decrypt(ciphertext);
}

/** Random-nonce AEAD for data at rest (local storage encryption). Output = nonce(24) || ciphertext. */
export function sealWithKey(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const nonce = randomBytes(24);
  return concat(nonce, xchacha20poly1305(key, nonce).encrypt(plaintext));
}

export function openWithKey(key: Uint8Array, sealed: Uint8Array): Uint8Array {
  return xchacha20poly1305(key, sealed.subarray(0, 24)).decrypt(sealed.subarray(24));
}
