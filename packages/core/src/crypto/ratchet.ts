import { bytesEqual, concat, fromBase64, readU32be, toBase64, u32be } from '../encoding';
import { aeadDecrypt, aeadEncrypt, dh, generateKeyPair, hkdfSha256, hmacSha256, type KeyPair } from './primitives';

/**
 * Double Ratchet, following https://signal.org/docs/specifications/doubleratchet/
 * Every function is pure: it returns a NEW state, so a message that fails to decrypt
 * (tampered / forged) can never corrupt the stored session.
 */

const MAX_SKIP = 1000; // max messages skipped in a single chain
const MAX_OLD_DHR = 5;

/** The message was already decrypted before. Callers should ignore it silently. */
export class DuplicateMessageError extends Error {
  constructor() {
    super('duplicate message');
    this.name = 'DuplicateMessageError';
  }
}
const MAX_STORED_SKIPPED = 2000; // total skipped keys kept across chains
const RK_INFO = 'MeetMe-Ratchet-v1';
export const HEADER_LEN = 40;

export interface RatchetState {
  DHs: KeyPair;
  DHr: Uint8Array | null;
  RK: Uint8Array;
  CKs: Uint8Array | null;
  CKr: Uint8Array | null;
  Ns: number;
  Nr: number;
  PN: number;
  /** key = base64(dhPub) + ':' + n */
  skipped: Map<string, Uint8Array>;
  AD: Uint8Array;
  /** Recent receiving ratchet keys we moved past; a message on one of them with no skipped key is a duplicate. */
  oldDHr?: Uint8Array[];
}

export interface Header {
  dh: Uint8Array;
  pn: number;
  n: number;
}

export const encodeHeader = (h: Header): Uint8Array => concat(h.dh, u32be(h.pn), u32be(h.n));

export function decodeHeader(b: Uint8Array): Header {
  if (b.length !== HEADER_LEN) throw new Error('bad header');
  return { dh: b.slice(0, 32), pn: readU32be(b, 32), n: readU32be(b, 36) };
}

function kdfRK(rk: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
  const out = hkdfSha256(dhOut, rk, RK_INFO, 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

function kdfCK(ck: Uint8Array): [Uint8Array, Uint8Array] {
  return [hmacSha256(ck, new Uint8Array([0x02])), hmacSha256(ck, new Uint8Array([0x01]))]; // [nextCK, MK]
}

function clone(s: RatchetState): RatchetState {
  return { ...s, skipped: new Map(s.skipped) };
}

export function initSender(sharedKey: Uint8Array, theirRatchetPub: Uint8Array, ad: Uint8Array): RatchetState {
  const DHs = generateKeyPair();
  const [RK, CKs] = kdfRK(sharedKey, dh(DHs.priv, theirRatchetPub));
  return { DHs, DHr: theirRatchetPub, RK, CKs, CKr: null, Ns: 0, Nr: 0, PN: 0, skipped: new Map(), AD: ad };
}

export function initReceiver(sharedKey: Uint8Array, ourRatchetKeyPair: KeyPair, ad: Uint8Array): RatchetState {
  return {
    DHs: ourRatchetKeyPair,
    DHr: null,
    RK: sharedKey,
    CKs: null,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    skipped: new Map(),
    AD: ad,
  };
}

export function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array,
): { state: RatchetState; header: Uint8Array; ciphertext: Uint8Array } {
  if (!state.CKs) throw new Error('session cannot send yet');
  const s = clone(state);
  const [nextCK, mk] = kdfCK(s.CKs!);
  s.CKs = nextCK;
  const header = encodeHeader({ dh: s.DHs.pub, pn: s.PN, n: s.Ns });
  s.Ns += 1;
  const ciphertext = aeadEncrypt(mk, plaintext, concat(s.AD, header));
  mk.fill(0);
  return { state: s, header, ciphertext };
}

function skipMessageKeys(s: RatchetState, until: number): void {
  if (!s.CKr) return;
  if (s.Nr + MAX_SKIP < until) throw new Error('too many skipped messages');
  while (s.Nr < until) {
    const [nextCK, mk] = kdfCK(s.CKr);
    s.CKr = nextCK;
    s.skipped.set(`${toBase64(s.DHr!)}:${s.Nr}`, mk);
    s.Nr += 1;
  }
  // Evict the oldest keys if the store grows too large (Map keeps insertion order).
  while (s.skipped.size > MAX_STORED_SKIPPED) {
    const oldest = s.skipped.keys().next().value as string;
    s.skipped.delete(oldest);
  }
}

function dhRatchet(s: RatchetState, header: Header): void {
  if (s.DHr) s.oldDHr = [s.DHr, ...(s.oldDHr ?? [])].slice(0, MAX_OLD_DHR);
  s.PN = s.Ns;
  s.Ns = 0;
  s.Nr = 0;
  s.DHr = header.dh;
  [s.RK, s.CKr] = kdfRK(s.RK, dh(s.DHs.priv, s.DHr));
  s.DHs = generateKeyPair();
  [s.RK, s.CKs] = kdfRK(s.RK, dh(s.DHs.priv, s.DHr));
}

export function ratchetDecrypt(
  state: RatchetState,
  headerBytes: Uint8Array,
  ciphertext: Uint8Array,
): { state: RatchetState; plaintext: Uint8Array } {
  const header = decodeHeader(headerBytes);
  const ad = concat(state.AD, headerBytes);
  const s = clone(state);

  const skippedKey = `${toBase64(header.dh)}:${header.n}`;
  const smk = s.skipped.get(skippedKey);
  if (smk) {
    const plaintext = aeadDecrypt(smk, ciphertext, ad);
    s.skipped.delete(skippedKey);
    return { state: s, plaintext };
  }

  // Already decrypted (the server re-sent it because our acknowledgement was lost): its key is gone.
  if (s.DHr && bytesEqual(header.dh, s.DHr) && header.n < s.Nr) throw new DuplicateMessageError();
  if (s.oldDHr?.some((k) => bytesEqual(k, header.dh))) throw new DuplicateMessageError();

  if (!s.DHr || !bytesEqual(header.dh, s.DHr)) {
    skipMessageKeys(s, header.pn);
    dhRatchet(s, header);
  }
  skipMessageKeys(s, header.n);
  const [nextCK, mk] = kdfCK(s.CKr!);
  s.CKr = nextCK;
  s.Nr += 1;
  const plaintext = aeadDecrypt(mk, ciphertext, ad); // throws on tampering -> state is discarded
  mk.fill(0);
  return { state: s, plaintext };
}

// ---- serialization (for encrypted local storage) ----

export interface SerializedRatchetState {
  DHs: [string, string];
  DHr: string | null;
  RK: string;
  CKs: string | null;
  CKr: string | null;
  Ns: number;
  Nr: number;
  PN: number;
  skipped: [string, string][];
  AD: string;
  oldDHr?: string[];
}

const b = (x: Uint8Array | null) => (x ? toBase64(x) : null);
const u = (x: string | null) => (x ? fromBase64(x) : null);

export function serializeState(s: RatchetState): SerializedRatchetState {
  return {
    DHs: [toBase64(s.DHs.pub), toBase64(s.DHs.priv)],
    DHr: b(s.DHr),
    RK: toBase64(s.RK),
    CKs: b(s.CKs),
    CKr: b(s.CKr),
    Ns: s.Ns,
    Nr: s.Nr,
    PN: s.PN,
    skipped: [...s.skipped].map(([k, v]) => [k, toBase64(v)]),
    AD: toBase64(s.AD),
    oldDHr: s.oldDHr?.map(toBase64),
  };
}

export function deserializeState(j: SerializedRatchetState): RatchetState {
  return {
    DHs: { pub: fromBase64(j.DHs[0]), priv: fromBase64(j.DHs[1]) },
    DHr: u(j.DHr),
    RK: fromBase64(j.RK),
    CKs: u(j.CKs),
    CKr: u(j.CKr),
    Ns: j.Ns,
    Nr: j.Nr,
    PN: j.PN,
    skipped: new Map(j.skipped.map(([k, v]) => [k, fromBase64(v)])),
    AD: fromBase64(j.AD),
    oldDHr: j.oldDHr?.map(fromBase64),
  };
}
