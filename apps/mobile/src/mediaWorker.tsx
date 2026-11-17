import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { fromBase64, toBase64, type OutgoingFile } from '@meetme/core';

/**
 * Photos before they are sent, like WhatsApp: made smaller (longest side 1600 px, JPEG) and given a tiny preview
 * that travels inside the encrypted message. Phones have no picture tools built into React Native, so an
 * invisible WebView (already part of the app) draws the photo on a canvas. It never loads anything from the
 * network and all of it stays in memory. iPhone HEIC photos become JPEG, which every platform can show.
 * "Other files" are sent untouched (like WhatsApp's "send as document").
 */
const MAX_SIDE = 1600;
const QUALITY = 0.8;
const KEEP_UNDER = 350 * 1024;
const THUMB_SIDE = 96;
const TIMEOUT_MS = 20_000;

const PAGE = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; script-src 'unsafe-inline'"></head><body><script>
function size(w, h, max) { var k = Math.min(1, max / Math.max(w, h)); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; }
function draw(img, max, q) {
  var s = size(img.naturalWidth, img.naturalHeight, max);
  var c = document.createElement('canvas'); c.width = s[0]; c.height = s[1];
  var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
  var u = c.toDataURL('image/jpeg', q); return u.slice(u.indexOf(',') + 1);
}
function reply(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
function handle(e) {
  var m; try { m = JSON.parse(e.data); } catch (_) { return; }
  if (!m || (m.type !== 'photo' && m.type !== 'sticker')) return;
  var img = new Image();
  img.onload = function () {
    if (m.type === 'sticker') {
      try {
        var side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas'); c.width = c.height = 512;
        c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
        var u = c.toDataURL('image/webp', 0.8), mime = 'image/webp';
        if (u.indexOf('data:image/webp') !== 0 || u.length > 400000) { u = c.toDataURL('image/jpeg', 0.8); mime = 'image/jpeg'; }
        reply({ type: 'done', id: m.id, data: u.slice(u.indexOf(',') + 1), mime: mime });
      } catch (err) { reply({ type: 'done', id: m.id, error: String(err) }); }
      return;
    }
    try {
      var big = Math.max(img.naturalWidth, img.naturalHeight);
      var out = { type: 'done', id: m.id, thumb: draw(img, ${THUMB_SIDE}, 0.55), w: img.naturalWidth, h: img.naturalHeight };
      if (m.convert || m.size > ${KEEP_UNDER} || big > ${MAX_SIDE}) out.data = draw(img, ${MAX_SIDE}, ${QUALITY});
      reply(out);
    } catch (err) { reply({ type: 'done', id: m.id, error: String(err) }); }
  };
  img.onerror = function () { reply({ type: 'done', id: m.id, error: 'decode' }); };
  img.src = 'data:' + m.mime + ';base64,' + m.data;
}
document.addEventListener('message', handle); window.addEventListener('message', handle);
reply({ type: 'ready' });
</script></body></html>`;

type Pending = { resolve: (r: { data?: string; thumb?: string; mime?: string } | null) => void; timer: ReturnType<typeof setTimeout> };
let post: ((msg: string) => void) | null = null;
let ready = false;
const waiting: (() => void)[] = [];
const pending = new Map<number, Pending>();
let nextId = 1;

/** Mounted once at the app root: the invisible drawing page. */
export function MediaWorkerHost() {
  const ref = useRef<WebView<{}>>(null);
  useEffect(() => {
    post = (m) => ref.current?.postMessage(m);
    return () => {
      post = null;
      ready = false;
    };
  }, []);
  const onMessage = (e: WebViewMessageEvent) => {
    let m: { type: string; id?: number; data?: string; thumb?: string; mime?: string; error?: string };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === 'ready') {
      ready = true;
      waiting.splice(0).forEach((f) => f());
      return;
    }
    const p = m.id !== undefined ? pending.get(m.id) : undefined;
    if (!p) return;
    pending.delete(m.id!);
    clearTimeout(p.timer);
    p.resolve(m.error ? null : { data: m.data, thumb: m.thumb, mime: m.mime });
  };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 }}>
      <WebView
        ref={ref}
        source={{ html: PAGE, baseUrl: 'about:blank' }}
        originWhitelist={['about:blank']}
        onShouldStartLoadWithRequest={(r) => r.url === 'about:blank' || r.url.startsWith('data:')}
        onMessage={onMessage}
        javaScriptEnabled
        cacheEnabled={false}
        incognito
        allowFileAccess={false}
        setSupportMultipleWindows={false}
        style={{ width: 1, height: 1 }}
      />
    </View>
  );
}

function whenReady(): Promise<void> {
  if (ready && post) return Promise.resolve();
  return new Promise((r) => waiting.push(r));
}

const COMPRESSIBLE = /^image\/(jpeg|png|webp|bmp|heic|heif)$/i;
const MUST_CONVERT = /^image\/(heic|heif)$/i;

/** Get a picked or camera photo ready to send. On any problem the original goes, unchanged. */
export async function prepareMedia(f: OutgoingFile): Promise<OutgoingFile> {
  if (!COMPRESSIBLE.test(f.mime)) return f;
  const result = await Promise.race([
    whenReady().then(
      () =>
        new Promise<{ data?: string; thumb?: string } | null>((resolve) => {
          const id = nextId++;
          const timer = setTimeout(() => (pending.delete(id), resolve(null)), TIMEOUT_MS);
          pending.set(id, { resolve, timer });
          post?.(JSON.stringify({ type: 'photo', id, mime: f.mime, size: f.data.length, convert: MUST_CONVERT.test(f.mime), data: toBase64(f.data) }));
        }),
    ),
    new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS + 1000)),
  ]).catch(() => null);
  if (!result) return f;
  const thumb = result.thumb;
  if (!result.data) return { ...f, thumb };
  const data = fromBase64(result.data);
  // A HEIC photo must become JPEG (other phones and Windows can't show HEIC); otherwise only if it got smaller.
  if (!MUST_CONVERT.test(f.mime) && data.length >= f.data.length) return { ...f, thumb };
  return { name: `${f.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, mime: 'image/jpeg', data, thumb };
}

/** A picture made into a sticker: the middle square, 512 x 512, WebP where the phone can (JPEG otherwise). */
export async function makeSticker(f: OutgoingFile): Promise<{ mime: string; data: Uint8Array }> {
  await whenReady();
  const r = await new Promise<{ data?: string; mime?: string } | null>((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => (pending.delete(id), resolve(null)), TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    post?.(JSON.stringify({ type: 'sticker', id, mime: f.mime, data: toBase64(f.data) }));
  });
  if (!r?.data || !r.mime) throw new Error('Could not make a sticker from this picture');
  return { mime: r.mime, data: fromBase64(r.data) };
}
