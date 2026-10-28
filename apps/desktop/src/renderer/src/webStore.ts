import type { BlobStorage, SecureStorage } from '@meetme/core';

/**
 * Storage for the web app (iPhone: Safari > Add to Home Screen). A browser has no OS keychain, so every value is
 * encrypted with AES-GCM under a key the browser creates as non-extractable: the page can use it, but no script
 * can read it out, and it never leaves this browser. Everything lives in IndexedDB.
 */
const DB = 'cellmate';
const KV = 'kv';
const BLOBS = 'blobs';
const KEYS = 'keys';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      for (const s of [KV, BLOBS, KEYS]) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp: Promise<IDBDatabase> | null = null;
const db = () => (dbp ??= openDb());

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

let keyp: Promise<CryptoKey> | null = null;
/** The browser's own encryption key (created once, can't be exported). */
function key(): Promise<CryptoKey> {
  return (keyp ??= (async () => {
    const saved = await run<CryptoKey | undefined>(KEYS, 'readonly', (s) => s.get('main'));
    if (saved) return saved;
    const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await run(KEYS, 'readwrite', (s) => s.put(k, 'main'));
    return k;
  })());
}

async function seal(data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), data as BufferSource));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function open(sealed: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) }, await key(), sealed.slice(12) as BufferSource));
}

export function webStore(): SecureStorage {
  return {
    async getItem(k) {
      const v = await run<Uint8Array | undefined>(KV, 'readonly', (s) => s.get(k));
      return v ? new TextDecoder().decode(await open(v)) : null;
    },
    async setItem(k, v) {
      const sealed = await seal(new TextEncoder().encode(v));
      await run(KV, 'readwrite', (s) => s.put(sealed, k));
    },
    async removeItem(k) {
      await run(KV, 'readwrite', (s) => s.delete(k));
    },
    async clear() {
      await run(KV, 'readwrite', (s) => s.clear());
    },
  };
}

/** Saved chat media (already encrypted by the app; stored as it comes). */
export function webBlobs(): BlobStorage {
  return {
    read: async (id) => (await run<Uint8Array | undefined>(BLOBS, 'readonly', (s) => s.get(id))) ?? null,
    write: async (id, data) => void (await run(BLOBS, 'readwrite', (s) => s.put(data, id))),
    remove: async (id) => void (await run(BLOBS, 'readwrite', (s) => s.delete(id))),
    clear: async () => void (await run(BLOBS, 'readwrite', (s) => s.clear())),
  };
}

/** Ask the browser not to delete our data when space runs low (iPhone home-screen apps keep it). */
export function keepStorage() {
  void navigator.storage?.persist?.().catch(() => {});
}
