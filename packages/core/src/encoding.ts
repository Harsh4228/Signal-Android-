// Small, dependency-free byte helpers. React Native has no Buffer, so we avoid it everywhere.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
  }
  return out;
}

export function fromBase64(str: string): Uint8Array {
  if (typeof str !== 'string' || str.length % 4 !== 0) throw new Error('invalid base64');
  const pad = str.endsWith('==') ? 2 : str.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((str.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < str.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => {
      const ch = str.charCodeAt(i + k);
      if (ch === 61 /* = */ && i + k >= str.length - pad) return 0;
      const v = ch < 128 ? B64_LOOKUP[ch]! : -1;
      if (v < 0) throw new Error('invalid base64');
      return v;
    });
    const n = (c[0]! << 18) | (c[1]! << 12) | (c[2]! << 6) | c[3]!;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// Not every runtime (e.g. Hermes in React Native) has TextEncoder/TextDecoder, so fall back to strict manual codecs.
const g = globalThis as unknown as {
  TextEncoder?: new () => { encode(s: string): Uint8Array };
  TextDecoder?: new (label: string, opts: { fatal: boolean }) => { decode(b: Uint8Array): string };
};
const encoder = g.TextEncoder ? new g.TextEncoder() : null;
const decoder = g.TextDecoder ? new g.TextDecoder('utf-8', { fatal: true }) : null;

export const utf8 = (s: string): Uint8Array => (encoder ? encoder.encode(s) : encodeUtf8(s));
export const fromUtf8 = (b: Uint8Array): string => (decoder ? decoder.decode(b) : decodeUtf8(b));

function encodeUtf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    let cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp < 0xe000) cp = 0xfffd; // lone surrogate -> replacement char (like TextEncoder)
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
}

function decodeUtf8(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++]!;
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c >= 0xc2 && c < 0xe0) cp = ((c & 0x1f) << 6) | cont(b, i++);
    else if (c >= 0xe0 && c < 0xf0) {
      cp = ((c & 0x0f) << 12) | (cont(b, i++) << 6) | cont(b, i++);
      if (cp < 0x800 || (cp >= 0xd800 && cp < 0xe000)) throw new Error('invalid utf-8');
    } else if (c >= 0xf0 && c < 0xf5) {
      cp = ((c & 0x07) << 18) | (cont(b, i++) << 12) | (cont(b, i++) << 6) | cont(b, i++);
      if (cp < 0x10000 || cp > 0x10ffff) throw new Error('invalid utf-8');
    } else throw new Error('invalid utf-8');
    out += String.fromCodePoint(cp);
  }
  return out;
}

function cont(b: Uint8Array, i: number): number {
  const c = b[i];
  if (c === undefined || (c & 0xc0) !== 0x80) throw new Error('invalid utf-8');
  return c & 0x3f;
}

/** Exposed for tests. */
export const _decodeUtf8Manual = decodeUtf8;
export const _encodeUtf8Manual = encodeUtf8;

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Constant-time comparison. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('u32 out of range');
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}

export function readU32be(b: Uint8Array, offset: number): number {
  return ((b[offset]! << 24) >>> 0) + (b[offset + 1]! << 16) + (b[offset + 2]! << 8) + b[offset + 3]!;
}

export function wipe(b: Uint8Array | null | undefined): void {
  if (b) b.fill(0);
}
