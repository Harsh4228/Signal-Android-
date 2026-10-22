import { bytesToHex } from '@noble/hashes/utils';
import type { AttachmentKind } from './attachments';
import { hmacSha256, openWithKey, randomBytes, sealWithKey } from './crypto/primitives';
import { fromBase64, toBase64 } from './encoding';
import type { ProtocolStore } from './store';

/**
 * Platform file store for saved media. Gets only ciphertext (MediaStore encrypts before writing), so it can be
 * a plain folder:
 *  - Desktop: files under the app's data folder (via the Electron main process)
 *  - Mobile:  files in the app's private document folder
 */
export interface BlobStorage {
  read(id: string): Promise<Uint8Array | null>;
  write(id: string, data: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
  /** Delete every saved file (log out / account wipe). */
  clear(): Promise<void>;
}

export class MemoryBlobStorage implements BlobStorage {
  private m = new Map<string, Uint8Array>();
  async read(id: string) {
    return this.m.get(id) ?? null;
  }
  async write(id: string, data: Uint8Array) {
    this.m.set(id, data);
  }
  async remove(id: string) {
    this.m.delete(id);
  }
  async clear() {
    this.m.clear();
  }
}

/** Blob ids are hex, so platform stores can use them as file names safely. */
export const BLOB_ID_RE = /^[0-9a-f]{32}$/;

/** A photo / document from a chat, kept on this device for the chat's "Media & docs" page. */
export interface MediaItem {
  /** The chat message it came with. */
  msgId: string;
  /** Chat key (username, or "#<groupId>"). */
  chat: string;
  /** Who sent it. */
  from: string;
  outgoing: boolean;
  ts: number;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** Text sent with the file. */
  caption?: string;
  /** Saved file. The same file in several chats (e.g. an announcement) is stored once. */
  blob: string;
}

/**
 * Saved chat media, like WhatsApp's "Media, links and docs". Each file is encrypted with a random media key
 * that lives in SecureStorage (OS keychain), so the files on disk are useless without this device's keychain.
 * The list itself (names, dates, who sent what) is in SecureStorage too.
 */
export class MediaStore {
  private items: MediaItem[] = [];
  private key: Uint8Array | null = null;

  constructor(
    private readonly store: ProtocolStore,
    private readonly blobs: BlobStorage,
  ) {}

  async load(): Promise<void> {
    this.items = await this.store.getSetting<MediaItem[]>('media', []);
  }

  private async mediaKey(): Promise<Uint8Array> {
    if (this.key) return this.key;
    const saved = await this.store.getSetting<string | null>('mediaKey', null);
    this.key = saved ? fromBase64(saved) : randomBytes(32);
    if (!saved) await this.store.setSetting('mediaKey', toBase64(this.key));
    return this.key;
  }

  /** Newest first. */
  list(chat: string): MediaItem[] {
    return this.items.filter((m) => m.chat === chat).sort((a, b) => b.ts - a.ts);
  }

  has(chat: string, msgId: string): boolean {
    return this.items.some((m) => m.chat === chat && m.msgId === msgId);
  }

  /** false = this message's file was already saved. */
  async add(item: Omit<MediaItem, 'blob'>, data: Uint8Array): Promise<boolean> {
    const key = await this.mediaKey();
    if (this.has(item.chat, item.msgId)) return false;
    // Named by a keyed hash of the content: the same file is stored once, and names reveal nothing.
    const blob = bytesToHex(hmacSha256(key, data)).slice(0, 32);
    const stored = this.items.some((m) => m.blob === blob);
    // Listed before the write, so a second save of the same file at the same moment doesn't write it again.
    const entry: MediaItem = { ...item, blob };
    this.items.push(entry);
    try {
      if (!stored) await this.blobs.write(blob, sealWithKey(key, data));
    } catch (e) {
      this.items = this.items.filter((m) => m !== entry);
      throw e;
    }
    await this.save();
    return true;
  }

  /** Decrypt a saved file into memory. */
  async read(item: MediaItem): Promise<Uint8Array> {
    const sealed = await this.blobs.read(item.blob);
    if (!sealed) throw new Error('This file is no longer on this device');
    return openWithKey(await this.mediaKey(), sealed);
  }

  /** Remove matching items; their files go too once nothing else uses them. Returns how many were removed. */
  async remove(match: (m: MediaItem) => boolean): Promise<number> {
    const gone = this.items.filter(match);
    if (!gone.length) return 0;
    this.items = this.items.filter((m) => !match(m));
    const unused = new Set(gone.map((m) => m.blob).filter((b) => !this.items.some((m) => m.blob === b)));
    await Promise.all([...unused].map((b) => this.blobs.remove(b)));
    await this.save();
    return gone.length;
  }

  /** Forget everything (the key store is wiped separately). */
  async clear(): Promise<void> {
    this.items = [];
    this.key = null;
    await this.blobs.clear();
  }

  private save() {
    return this.store.setSetting('media', this.items);
  }
}
