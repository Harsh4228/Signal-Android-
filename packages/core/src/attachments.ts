import { bytesEqual } from './encoding';
import { openWithKey, randomBytes, sealWithKey, sha256 } from './crypto/primitives';

/** Encrypt a file with a fresh random key (never reused). */
export function encryptAttachment(plaintext: Uint8Array): { ciphertext: Uint8Array; key: Uint8Array; digest: Uint8Array } {
  const key = randomBytes(32);
  const ciphertext = sealWithKey(key, plaintext);
  return { ciphertext, key, digest: sha256(ciphertext) };
}

export function decryptAttachment(ciphertext: Uint8Array, key: Uint8Array, digest: Uint8Array): Uint8Array {
  if (!bytesEqual(sha256(ciphertext), digest)) throw new Error('attachment was modified');
  return openWithKey(key, ciphertext); // AEAD: also fails on any tampering
}

export type AttachmentKind = 'image' | 'pdf' | 'audio' | 'file';

export function attachmentKind(mime: string, name: string): AttachmentKind {
  if (/^image\/(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(mime)) return 'image';
  if (/^audio\/(webm|ogg|mp4|aac|mpeg|m4a|x-m4a|wav)$/i.test(mime)) return 'audio';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  return 'file';
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** File names come from other people - keep them short and harmless for display. */
export function safeFileName(name: string): string {
  const cleaned = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '') // control + bidi-override chars
    .replace(/[\\/]/g, '_')
    .trim();
  return (cleaned || 'file').slice(0, 120);
}
