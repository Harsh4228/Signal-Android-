import { concat, utf8 } from './encoding';
import { sha512 } from './crypto/primitives';

/**
 * Safety number (like Signal's). Both users see the same 60 digits. If they compare them in person
 * (or scan each other's QR) and they match, no one - not even the server - is in the middle.
 */
const ITERATIONS = 5200;

function displayable(username: string, identityKey: Uint8Array): string {
  let hash = concat(new Uint8Array([0, 0]), identityKey, utf8(username));
  for (let i = 0; i < ITERATIONS; i++) hash = sha512(concat(hash, identityKey));
  let out = '';
  for (let i = 0; i < 30; i += 5) {
    // 5 bytes -> number -> 5 digits
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + hash[i + j]!;
    out += String(n % 100000).padStart(5, '0');
  }
  return out;
}

export function safetyNumber(
  ourName: string,
  ourKey: Uint8Array,
  theirName: string,
  theirKey: Uint8Array,
): string {
  const a = displayable(ourName, ourKey);
  const b = displayable(theirName, theirKey);
  const digits = ourName < theirName ? a + b : b + a;
  return digits.match(/.{5}/g)!.join(' ');
}
