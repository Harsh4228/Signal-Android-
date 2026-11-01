/**
 * Things shared INTO CellMate from outside:
 *  - web app installed on Android ("Share" -> CellMate): the service worker keeps them in the 'cellmate-share' cache
 *  - Windows desktop app (right-click a file -> Send to -> CellMate): the main process hands the files over
 * Either way the person then picks the chats in the "Send to…" window and they go end-to-end encrypted.
 */
export type SharedFile = { name: string; mime: string; data: Uint8Array };
export type SharedIn = { files: SharedFile[]; text: string };

const SHARE_CACHE = 'cellmate-share';

/** What was shared since the last call (taken once), or null. */
export async function takeSharedIn(): Promise<SharedIn | null> {
  if (window.meetme.takeShared) {
    const r = await window.meetme.takeShared().catch(() => null);
    return r && (r.files.length || r.text) ? r : null;
  }
  if (!('caches' in window)) return null;
  try {
    if (!(await caches.has(SHARE_CACHE))) return null;
    const cache = await caches.open(SHARE_CACHE);
    const head = await cache.match('/app/share-inbox/manifest.json');
    if (!head) return null;
    const m = (await head.json()) as { files: { key: string; name: string; mime: string }[]; text: string; ts: number };
    const files: SharedFile[] = [];
    // Shared a day ago and never opened: don't send it by surprise.
    if (Date.now() - m.ts < 86_400_000) {
      for (const f of m.files) {
        const res = await cache.match(f.key);
        if (res) files.push({ name: f.name, mime: f.mime || 'application/octet-stream', data: new Uint8Array(await res.arrayBuffer()) });
      }
    }
    await caches.delete(SHARE_CACHE);
    const text = Date.now() - m.ts < 86_400_000 ? m.text : '';
    return files.length || text ? { files, text } : null;
  } catch {
    return null;
  }
}

/** Desktop app: files sent while CellMate is already open. Returns the unsubscribe function. */
export function onSharedIn(fn: () => void): () => void {
  return window.meetme.onShared?.(fn) ?? (() => {});
}
