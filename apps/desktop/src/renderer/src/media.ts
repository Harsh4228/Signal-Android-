import { toBase64, type OutgoingFile } from '@meetme/core';

/**
 * Photos and videos before they are sent, like WhatsApp:
 *  - photos are made smaller (longest side 1600 px, JPEG): a 5 MB camera photo becomes ~300 KB, so chats load
 *    fast and the server stores far less. "Other files" sends the original untouched (like "send as document").
 *  - photos and videos get a tiny preview picture that travels inside the encrypted message, so the other
 *    person sees it at once while the file downloads.
 * Everything happens in memory; nothing is written to disk.
 */
const MAX_SIDE = 1600;
const QUALITY = 0.8;
/** Small enough photos are sent as they are. */
const KEEP_UNDER = 350 * 1024;
const THUMB_SIDE = 96;
const POSTER_SIDE = 240;

const COMPRESSIBLE = /^image\/(jpeg|png|webp|bmp)$/i;

function canvasFor(w: number, h: number, max: number) {
  const scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d')!;
  // JPEG has no transparency: put PNG cut-outs on white instead of black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

async function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not encode the picture');
  return new Uint8Array(await blob.arrayBuffer());
}

async function thumbOf(source: CanvasImageSource, w: number, h: number, side = THUMB_SIDE, quality = 0.55): Promise<string> {
  const { canvas, ctx } = canvasFor(w, h, side);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return toBase64(await toJpeg(canvas, quality));
}

const jpgName = (name: string) => `${name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`;

/** A photo, made smaller when that helps, with its preview. Anything that can't be decoded goes as it is. */
async function preparePhoto(f: OutgoingFile): Promise<OutgoingFile> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([f.data as BlobPart], { type: f.mime }), { imageOrientation: 'from-image' });
  } catch {
    return f; // e.g. HEIC on Windows: send the original
  }
  try {
    const thumb = await thumbOf(bitmap, bitmap.width, bitmap.height).catch(() => undefined);
    if (!COMPRESSIBLE.test(f.mime) || (f.data.length <= KEEP_UNDER && Math.max(bitmap.width, bitmap.height) <= MAX_SIDE)) {
      return { ...f, thumb };
    }
    const { canvas, ctx } = canvasFor(bitmap.width, bitmap.height, MAX_SIDE);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = await toJpeg(canvas, QUALITY);
    // Keep the original when "smaller" isn't (e.g. an already well-compressed small JPEG).
    if (data.length >= f.data.length) return { ...f, thumb };
    return { name: jpgName(f.name), mime: 'image/jpeg', data, thumb };
  } finally {
    bitmap.close();
  }
}

/** A frame from about a third into the video (at most 1 s) as its preview. undefined if the video can't be read. */
async function videoPoster(f: OutgoingFile): Promise<string | undefined> {
  const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime }));
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  try {
    return await new Promise<string | undefined>((resolve) => {
      const give = () => resolve(undefined);
      const timer = setTimeout(give, 5000);
      video.onerror = () => (clearTimeout(timer), give());
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(1, (video.duration || 0) / 3);
      };
      video.onseeked = () => {
        clearTimeout(timer);
        if (!video.videoWidth) return give();
        thumbOf(video, video.videoWidth, video.videoHeight, POSTER_SIDE, 0.6).then(resolve, give);
      };
      video.src = url;
    });
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Get a picked / pasted / dropped / camera file ready to send as a photo or video. */
export async function prepareMedia(f: OutgoingFile): Promise<OutgoingFile> {
  try {
    if (/^image\//i.test(f.mime) && !/gif/i.test(f.mime)) return await preparePhoto(f);
    if (/^video\//i.test(f.mime)) return { ...f, thumb: await videoPoster(f) };
  } catch (e) {
    console.warn('could not prepare media', e);
  }
  return f;
}

/** Voice messages: MP4 (AAC) where this computer can record it, so iPhones can play them; otherwise WebM. */
export function voiceMime(): string {
  for (const t of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return 'audio/webm';
}

/** Turn a picture into a sticker: the middle square, 512 x 512, WebP (small, keeps transparency). */
export async function makeSticker(f: OutgoingFile): Promise<{ mime: string; data: Uint8Array }> {
  const bmp = await createImageBitmap(new Blob([f.data as BlobPart], { type: f.mime }), { imageOrientation: 'from-image' });
  try {
    const side = Math.min(bmp.width, bmp.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 512, 512);
    for (const q of [0.85, 0.7, 0.5]) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', q));
      if (blob && blob.size <= 300 * 1024) return { mime: blob.type || 'image/webp', data: new Uint8Array(await blob.arrayBuffer()) };
    }
    throw new Error('Could not make a small enough sticker');
  } finally {
    bmp.close();
  }
}
