import { concat, utf8 } from '../encoding';
import {
  dh,
  generateKeyPair,
  hkdfSha256,
  identityDhPriv,
  identityDhPub,
  sign,
  verify,
  type IdentityKeyPair,
  type KeyPair,
} from './primitives';

/**
 * X3DH key agreement, following https://signal.org/docs/specifications/x3dh/
 * Curve: X25519, hash: SHA-256. Identity keys are Ed25519 and converted to X25519 for DH.
 */

const X3DH_INFO = 'MeetMe-X3DH-v1';
const SPK_SIG_PREFIX = utf8('MeetMe-SignedPreKey-v1');

export interface PreKeyBundle {
  identityKey: Uint8Array; // Ed25519 public key
  signedPreKey: { id: number; pub: Uint8Array; sig: Uint8Array };
  oneTimePreKey?: { id: number; pub: Uint8Array };
}

export const signPreKey = (identity: IdentityKeyPair, spkPub: Uint8Array): Uint8Array =>
  sign(identity.priv, concat(SPK_SIG_PREFIX, spkPub));

export const verifyPreKeySignature = (identityPub: Uint8Array, spkPub: Uint8Array, sig: Uint8Array): boolean =>
  verify(identityPub, concat(SPK_SIG_PREFIX, spkPub), sig);

function kdf(...dhs: Uint8Array[]): Uint8Array {
  const F = new Uint8Array(32).fill(0xff);
  return hkdfSha256(concat(F, ...dhs), new Uint8Array(32), X3DH_INFO, 32);
}

export interface X3DHInitiatorResult {
  sharedKey: Uint8Array;
  associatedData: Uint8Array;
  ephemeralPub: Uint8Array;
  signedPreKeyId: number;
  oneTimePreKeyId?: number;
}

/** Alice's side: compute the shared secret from Bob's published bundle. */
export function x3dhInitiate(ourIdentity: IdentityKeyPair, bundle: PreKeyBundle): X3DHInitiatorResult {
  if (!verifyPreKeySignature(bundle.identityKey, bundle.signedPreKey.pub, bundle.signedPreKey.sig)) {
    throw new Error('Signed prekey signature is invalid - possible attack, refusing to start session');
  }
  const ek: KeyPair = generateKeyPair();
  const dh1 = dh(identityDhPriv(ourIdentity.priv), bundle.signedPreKey.pub);
  const dh2 = dh(ek.priv, identityDhPub(bundle.identityKey));
  const dh3 = dh(ek.priv, bundle.signedPreKey.pub);
  const dhs = [dh1, dh2, dh3];
  if (bundle.oneTimePreKey) dhs.push(dh(ek.priv, bundle.oneTimePreKey.pub));
  const sharedKey = kdf(...dhs);
  dhs.forEach((d) => d.fill(0));
  ek.priv.fill(0);
  return {
    sharedKey,
    associatedData: concat(ourIdentity.pub, bundle.identityKey),
    ephemeralPub: ek.pub,
    signedPreKeyId: bundle.signedPreKey.id,
    oneTimePreKeyId: bundle.oneTimePreKey?.id,
  };
}

/** Bob's side: recompute the same secret from Alice's initial message. */
export function x3dhRespond(params: {
  ourIdentity: IdentityKeyPair;
  ourSignedPreKey: KeyPair;
  ourOneTimePreKey?: KeyPair;
  theirIdentityKey: Uint8Array;
  theirEphemeralKey: Uint8Array;
}): { sharedKey: Uint8Array; associatedData: Uint8Array } {
  const { ourIdentity, ourSignedPreKey, ourOneTimePreKey, theirIdentityKey, theirEphemeralKey } = params;
  const dh1 = dh(ourSignedPreKey.priv, identityDhPub(theirIdentityKey));
  const dh2 = dh(identityDhPriv(ourIdentity.priv), theirEphemeralKey);
  const dh3 = dh(ourSignedPreKey.priv, theirEphemeralKey);
  const dhs = [dh1, dh2, dh3];
  if (ourOneTimePreKey) dhs.push(dh(ourOneTimePreKey.priv, theirEphemeralKey));
  const sharedKey = kdf(...dhs);
  dhs.forEach((d) => d.fill(0));
  return { sharedKey, associatedData: concat(theirIdentityKey, ourIdentity.pub) };
}
