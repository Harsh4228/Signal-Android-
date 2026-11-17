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

export type AttachmentKind = 'image' | 'video' | 'pdf' | 'audio' | 'file';

/** Videos every platform's player can show (MP4 / MOV / WebM / 3GP). */
const VIDEO_RE = /^video\/(mp4|quicktime|webm|3gpp|3gpp2|x-m4v|mpeg)$/i;
const VIDEO_EXT_RE = /\.(mp4|m4v|mov|webm|3gp)$/i;

export function attachmentKind(mime: string, name: string): AttachmentKind {
  if (/^image\/(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(mime)) return 'image';
  if (VIDEO_RE.test(mime) || (mime === 'application/octet-stream' && VIDEO_EXT_RE.test(name))) return 'video';
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

/**
 * A small preview picture sent with a photo or video (base64 JPEG, a few KB), so the chat shows something at once
 * while the file itself downloads. Anything else (too big, not base64) is ignored.
 */
export const MAX_THUMB_CHARS = 24_000;
export function validThumb(t: unknown): t is string {
  return typeof t === 'string' && t.length > 0 && t.length <= MAX_THUMB_CHARS && /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}
