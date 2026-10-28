import { scryptAsync } from '@noble/hashes/scrypt';
import { openWithKey, randomBytes, sealWithKey } from './crypto/primitives';
import { fromBase64, fromUtf8, toBase64, utf8 } from './encoding';
import type { HistoryBackup } from './api';
import { MAX_BACKUP_CHARS } from './api';
import type { ChatMessage } from './client';

/**
 * Chat history that survives restarts and moves to a new device (like WhatsApp):
 *  - On the device it is one file, encrypted with the device's media key (see MediaStore.saveDoc).
 *  - On the server it is an end-to-end encrypted backup: the history is sealed with a random backup key, and that
 *    key with a key made from the person's login password (scrypt). The server can't open either.
 * File bytes are never in the history: files stay in the media store, or are fetched again from the server.
 */
export const HISTORY_VERSION = 1;
/** Most messages kept per chat (the oldest go first). */
export const MAX_KEPT_PER_CHAT = 5000;

export interface HistorySnapshot {
  v: number;
  savedAt: number;
  chats: Record<string, ChatMessage[]>;
  contacts: string[];
  unread: Record<string, number>;
}

/** The backup key and how it is locked with the password (kept in the device's secure store). */
export interface BackupKeys {
  key: string;
  salt: string;
  wrap: string;
}

/** A copy of a message without file bytes, typing state or anything that only makes sense in memory. */
function storable(m: ChatMessage): ChatMessage {
  const copy: ChatMessage = { ...m };
  if (m.attachment) {
    const { data: _drop, ...rest } = m.attachment;
    copy.attachment = { ...rest, state: rest.state === 'ready' || rest.state === 'downloading' ? 'downloading' : rest.state };
  }
  if (copy.status === 'sending') copy.status = 'failed';
  return copy;
}

export function makeSnapshot(chats: Map<string, ChatMessage[]>, contacts: string[], unread: Map<string, number>, now = Date.now()): HistorySnapshot {
  const out: HistorySnapshot = { v: HISTORY_VERSION, savedAt: now, chats: {}, contacts: [...contacts], unread: {} };
  for (const [key, list] of chats) {
    // Disappearing messages never leave memory: they must not outlive their timer in a file or a backup.
    const kept = list.filter((m) => !m.expiresAt).slice(-MAX_KEPT_PER_CHAT);
    if (kept.length) out.chats[key] = kept.map(storable);
  }
  for (const [key, n] of unread) if (n > 0) out.unread[key] = n;
  return out;
}

/** Parses a stored snapshot; null if it isn't one. Messages without the basic fields are dropped. */
export function parseSnapshot(text: string): HistorySnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const s = raw as Partial<HistorySnapshot>;
  if (!s || typeof s !== 'object' || typeof s.chats !== 'object' || !s.chats) return null;
  const chats: Record<string, ChatMessage[]> = {};
  for (const [key, list] of Object.entries(s.chats)) {
    if (!Array.isArray(list) || key.length > 64) continue;
    chats[key] = list.filter((m): m is ChatMessage => !!m && typeof m.id === 'string' && typeof m.ts === 'number' && typeof m.text === 'string');
  }
  return {
    v: Number(s.v) || HISTORY_VERSION,
    savedAt: Number(s.savedAt) || 0,
    chats,
    contacts: Array.isArray(s.contacts) ? s.contacts.filter((c): c is string => typeof c === 'string') : [],
    unread: s.unread && typeof s.unread === 'object' ? (s.unread as Record<string, number>) : {},
  };
}

/** Adds the messages of `from` that `into` doesn't have yet, in time order. */
export function mergeSnapshot(into: Map<string, ChatMessage[]>, from: HistorySnapshot): number {
  let added = 0;
  for (const [key, list] of Object.entries(from.chats)) {
    const have = into.get(key) ?? [];
    const ids = new Set(have.map((m) => m.id));
    const fresh = list.filter((m) => !ids.has(m.id));
    if (!fresh.length) continue;
    added += fresh.length;
    into.set(key, [...have, ...fresh].sort((a, b) => a.ts - b.ts));
  }
  return added;
}

// ---- the password-locked backup ----

/** A key from the login password. Slow on purpose, so a stolen backup can't be guessed quickly. */
async function passwordKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return scryptAsync(utf8(password), salt, { N: 16384, r: 8, p: 1, dkLen: 32 });
}

/** A new backup key, locked with this password. */
export async function newBackupKeys(password: string): Promise<BackupKeys> {
  return lockBackupKey(randomBytes(32), password);
}

export async function lockBackupKey(key: Uint8Array, password: string): Promise<BackupKeys> {
  const salt = randomBytes(16);
  const wrap = sealWithKey(await passwordKey(password, salt), key);
  return { key: toBase64(key), salt: toBase64(salt), wrap: toBase64(wrap) };
}

/** Unlocks a backup's key with a password; null if the password doesn't open it. */
export async function unlockBackupKey(b: Pick<HistoryBackup, 'salt' | 'wrap'>, password: string): Promise<Uint8Array | null> {
  try {
    return openWithKey(await passwordKey(password, fromBase64(b.salt)), fromBase64(b.wrap));
  } catch {
    return null;
  }
}

/** Seals a snapshot for the server. Too big: the oldest messages are left out until it fits. */
export function sealBackup(snapshot: HistorySnapshot, keys: BackupKeys): Omit<HistoryBackup, 'updatedAt'> {
  const key = fromBase64(keys.key);
  let s = snapshot;
  for (let keep = MAX_KEPT_PER_CHAT; ; keep = Math.floor(keep / 2)) {
    const data = toBase64(sealWithKey(key, utf8(JSON.stringify(s))));
    if (data.length <= MAX_BACKUP_CHARS - 1024 || keep < 10) return { data, wrap: keys.wrap, salt: keys.salt, v: HISTORY_VERSION };
    s = { ...s, chats: Object.fromEntries(Object.entries(s.chats).map(([k, l]) => [k, l.slice(-keep)])) };
  }
}

export function openBackup(b: Pick<HistoryBackup, 'data'>, key: Uint8Array): HistorySnapshot | null {
  try {
    return parseSnapshot(fromUtf8(openWithKey(key, fromBase64(b.data))));
  } catch {
    return null;
  }
}
