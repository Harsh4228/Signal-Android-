import { fromBase64, toBase64 } from './encoding';
import type { IdentityKeyPair, KeyPair } from './crypto/primitives';
import { deserializeState, serializeState, type RatchetState, type SerializedRatchetState } from './crypto/ratchet';

/**
 * Platform storage adapter. Every platform MUST provide an encrypted implementation:
 *  - Desktop: Electron safeStorage (DPAPI on Windows / Keychain on macOS)
 *  - Mobile:  iOS Keychain / Android Keystore (react-native-keychain)
 * Only keys and session state are stored. Message history is kept in RAM only.
 */
export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Wipe everything (used for "delete account" / panic wipe). */
  clear(): Promise<void>;
}

export class MemoryStorage implements SecureStorage {
  private m = new Map<string, string>();
  async getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  async removeItem(k: string) {
    this.m.delete(k);
  }
  async clear() {
    this.m.clear();
  }
}

export interface Account {
  serverUrl: string;
  username: string;
  password: string;
  identity: IdentityKeyPair;
}

export interface SignedPreKeyRecord {
  id: number;
  keyPair: KeyPair;
  sig: Uint8Array;
  createdAt: number;
}

export interface SessionRecord {
  state: RatchetState;
  theirIdentity: Uint8Array;
  /** Alice's X3DH ephemeral key - identifies the session for repeated prekey messages. */
  baseKey: Uint8Array;
  /** Set on the initiator until the peer replies; outgoing messages are sent as prekey messages. */
  pending?: { ek: Uint8Array; spkId: number; opkId?: number };
  createdAt: number;
}

export interface TrustedIdentity {
  key: Uint8Array;
  verified: boolean;
  firstSeen: number;
}

const kp = (k: KeyPair) => [toBase64(k.pub), toBase64(k.priv)];
const unkp = (a: string[]): KeyPair => ({ pub: fromBase64(a[0]!), priv: fromBase64(a[1]!) });

/** Typed, serialized access on top of SecureStorage. */
export class ProtocolStore {
  constructor(private readonly storage: SecureStorage) {}

  private async getJson<T>(key: string): Promise<T | null> {
    const v = await this.storage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  }
  private setJson(key: string, value: unknown) {
    return this.storage.setItem(key, JSON.stringify(value));
  }

  // ---- account ----
  async getAccount(): Promise<Account | null> {
    const j = await this.getJson<{ serverUrl: string; username: string; password: string; identity: string[] }>(
      'account',
    );
    return j ? { ...j, identity: unkp(j.identity) } : null;
  }
  saveAccount(a: Account) {
    return this.setJson('account', { ...a, identity: kp(a.identity) });
  }

  // ---- signed prekeys ----
  async getSignedPreKeys(): Promise<SignedPreKeyRecord[]> {
    const j = await this.getJson<{ id: number; kp: string[]; sig: string; createdAt: number }[]>('spk');
    return (j ?? []).map((r) => ({ id: r.id, keyPair: unkp(r.kp), sig: fromBase64(r.sig), createdAt: r.createdAt }));
  }
  saveSignedPreKeys(list: SignedPreKeyRecord[]) {
    return this.setJson(
      'spk',
      list.map((r) => ({ id: r.id, kp: kp(r.keyPair), sig: toBase64(r.sig), createdAt: r.createdAt })),
    );
  }

  // ---- one-time prekeys ----
  async getOneTimePreKeys(): Promise<{ nextId: number; keys: Map<number, KeyPair> }> {
    const j = await this.getJson<{ nextId: number; keys: [number, string[]][] }>('opk');
    return { nextId: j?.nextId ?? 1, keys: new Map((j?.keys ?? []).map(([id, k]) => [id, unkp(k)])) };
  }
  saveOneTimePreKeys(v: { nextId: number; keys: Map<number, KeyPair> }) {
    return this.setJson('opk', { nextId: v.nextId, keys: [...v.keys].map(([id, k]) => [id, kp(k)]) });
  }

  // ---- sessions ----
  async getSessions(peer: string): Promise<SessionRecord[]> {
    type J = {
      state: SerializedRatchetState;
      theirIdentity: string;
      baseKey: string;
      pending?: { ek: string; spkId: number; opkId?: number };
      createdAt: number;
    };
    const j = await this.getJson<J[]>(`session:${peer}`);
    return (j ?? []).map((r) => ({
      state: deserializeState(r.state),
      theirIdentity: fromBase64(r.theirIdentity),
      baseKey: fromBase64(r.baseKey),
      pending: r.pending && { ...r.pending, ek: fromBase64(r.pending.ek) },
      createdAt: r.createdAt,
    }));
  }
  saveSessions(peer: string, list: SessionRecord[]) {
    return this.setJson(
      `session:${peer}`,
      list.map((r) => ({
        state: serializeState(r.state),
        theirIdentity: toBase64(r.theirIdentity),
        baseKey: toBase64(r.baseKey),
        pending: r.pending && { ...r.pending, ek: toBase64(r.pending.ek) },
        createdAt: r.createdAt,
      })),
    );
  }
  deleteSessions(peer: string) {
    return this.storage.removeItem(`session:${peer}`);
  }

  // ---- trusted identities (TOFU + safety number verification) ----
  async getIdentity(peer: string): Promise<TrustedIdentity | null> {
    const j = await this.getJson<{ key: string; verified: boolean; firstSeen: number }>(`identity:${peer}`);
    return j ? { ...j, key: fromBase64(j.key) } : null;
  }
  saveIdentity(peer: string, t: TrustedIdentity) {
    return this.setJson(`identity:${peer}`, { ...t, key: toBase64(t.key) });
  }

  // ---- contacts (just usernames, no message content) ----
  async getContacts(): Promise<string[]> {
    return (await this.getJson<string[]>('contacts')) ?? [];
  }
  saveContacts(c: string[]) {
    return this.setJson('contacts', c);
  }

  // ---- small app settings ----
  async getSetting<T>(name: string, fallback: T): Promise<T> {
    return (await this.getJson<T>(`setting:${name}`)) ?? fallback;
  }
  setSetting(name: string, value: unknown) {
    return this.setJson(`setting:${name}`, value);
  }

  wipe() {
    return this.storage.clear();
  }
}
