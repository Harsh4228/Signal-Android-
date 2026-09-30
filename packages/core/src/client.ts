import { bytesToHex } from '@noble/hashes/utils';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_TEXT_LENGTH,
  USERNAME_RE,
  type AdminUser,
  type AttachmentPointer,
  type ClientFrame,
  type LoginRequest,
  type PublicConfig,
  type IceConfigResponse,
  type KeyBundleResponse,
  type Payload,
  type ServerFrame,
  type UploadKeysRequest,
} from './api';
import { attachmentKind, decryptAttachment, encryptAttachment, safeFileName, type AttachmentKind } from './attachments';
import { randomBytes } from './crypto/primitives';
import type { PreKeyBundle } from './crypto/x3dh';
import { Emitter } from './emitter';
import { fromBase64, toBase64, utf8 } from './encoding';
import { safetyNumber } from './fingerprint';
import {
  createAccount,
  generateOneTimePreKeys,
  maybeRotateSignedPreKey,
  ONE_TIME_PREKEY_BATCH,
  ONE_TIME_PREKEY_LOW_WATER,
} from './keys';
import { SessionCipher, type WireMessage } from './session';
import { ProtocolStore, type Account, type SecureStorage } from './store';

export type ConnectionStatus = 'offline' | 'connecting' | 'online';
export type CallSignal = Extract<Payload, { k: 'call' }>;

export interface ChatMessage {
  id: string;
  peer: string;
  text: string;
  ts: number;
  outgoing: boolean;
  system?: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  expiresAt?: number;
  receiptSent?: 'delivered' | 'read';
  /** Company-wide announcement from an admin. */
  broadcast?: boolean;
  attachment?: Attachment;
}

/** A file in a chat. `data` lives only in memory - it is never written to disk. */
export interface Attachment {
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  state: 'uploading' | 'downloading' | 'ready' | 'failed';
  data?: Uint8Array;
}

export interface OutgoingFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

export interface BroadcastResult {
  sent: number;
  failed: string[];
}

type Events = {
  change: [];
  message: [ChatMessage];
  callSignal: [string, CallSignal];
  identityChanged: [string];
  error: [string];
};

export interface ClientOptions {
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
}

export class MustChangePasswordError extends Error {
  constructor() {
    super('Please choose your own new password');
  }
}

/** Easy-to-read temporary password for new employees (no 0/O, 1/l/I). */
export function generatePassword(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const limit = 256 - (256 % alphabet.length); // reject bytes above this: no modulo bias
  let out = '';
  while (out.length < length) {
    for (const b of randomBytes(32)) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const newId = () => bytesToHex(randomBytes(16));
const PAD_BLOCK = 160; // hide exact message length, like Signal
const pad = (s: string) => s + ' '.repeat((PAD_BLOCK - (utf8(s).length % PAD_BLOCK)) % PAD_BLOCK);

function checkFile(f: OutgoingFile) {
  if (!f.data?.length) throw new Error('File is empty');
  if (f.data.length > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB)`);
  }
}

function validPointer(p: AttachmentPointer): boolean {
  return (
    typeof p === 'object' &&
    /^[0-9a-f]{32}$/.test(String(p.id)) &&
    typeof p.key === 'string' &&
    typeof p.digest === 'string' &&
    typeof p.name === 'string' &&
    typeof p.mime === 'string' &&
    /^[\w.+-]{1,64}\/[\w.+-]{1,100}$/.test(p.mime) && // used in data: URLs, so keep it strict
    p.name.length <= 1000 &&
    Number.isInteger(p.size) &&
    p.size > 0 &&
    p.size <= MAX_ATTACHMENT_BYTES
  );
}

function parseBundle(b: KeyBundleResponse): PreKeyBundle {
  return {
    identityKey: fromBase64(b.identityKey),
    signedPreKey: { id: b.signedPreKey.id, pub: fromBase64(b.signedPreKey.pub), sig: fromBase64(b.signedPreKey.sig) },
    oneTimePreKey: b.oneTimePreKey && { id: b.oneTimePreKey.id, pub: fromBase64(b.oneTimePreKey.pub) },
  };
}

/**
 * The whole messenger, UI-independent. Desktop (Electron) and mobile (React Native) both use this.
 * Keys + sessions go to encrypted SecureStorage. Messages live ONLY in memory - nothing is written to disk.
 */
export class MessengerClient extends Emitter<Events> {
  readonly store: ProtocolStore;
  private readonly cipher: SessionCipher;
  private readonly WS: typeof WebSocket;
  private readonly fetchImpl: typeof fetch;

  account: Account | null = null;
  contacts: string[] = [];
  status: ConnectionStatus = 'offline';
  activeChat: string | null = null;
  isAdmin = false;
  admins: string[] = [];

  private chats = new Map<string, ChatMessage[]>();
  private unread = new Map<string, number>();
  private timers: Record<string, number> = {};
  private locks = new Map<string, Promise<unknown>>();
  private pendingSends = new Map<string, { peer: string; msgId: string }>();
  private ws: WebSocket | null = null;
  private wantOnline = false;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(storage: SecureStorage, opts: ClientOptions = {}) {
    super();
    this.store = new ProtocolStore(storage);
    this.cipher = new SessionCipher(this.store);
    this.WS = opts.WebSocket ?? globalThis.WebSocket;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Loads the saved account. Returns false if the user still has to register. */
  async init(): Promise<boolean> {
    this.account = await this.store.getAccount();
    this.contacts = await this.store.getContacts();
    this.timers = await this.store.getSetting<Record<string, number>>('timers', {});
    this.sweepTimer ??= setInterval(() => this.sweepExpired(), 1000);
    return !!this.account;
  }

  async register(serverUrl: string, username: string): Promise<void> {
    username = username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Username: 3-32 chars, a-z 0-9 _ .');
    serverUrl = serverUrl.trim().replace(/\/+$/, '');
    const { account, signedPreKey, oneTimePreKeys } = await createAccount(this.store, serverUrl, username);
    try {
      const res = await this.fetchImpl(`${serverUrl}/v1/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username,
          password: account.password,
          identityKey: toBase64(account.identity.pub),
          signedPreKey,
          oneTimePreKeys,
        }),
      });
      if (!res.ok) throw new ApiError(res.status, res.status === 409 ? 'Username already taken' : await res.text());
    } catch (e) {
      await this.store.wipe();
      throw e;
    }
    this.account = account;
    this.contacts = [];
    this.emit('change');
  }

  /** Public server settings (no account needed), e.g. whether self sign-up is allowed. */
  async getPublicConfig(serverUrl: string): Promise<PublicConfig> {
    const res = await this.fetchImpl(`${serverUrl.trim().replace(/\/+$/, '')}/v1/config`);
    if (!res.ok) throw new ApiError(res.status, 'Cannot reach server');
    return (await res.json()) as PublicConfig;
  }

  /**
   * Log in with the ID + password the admin created. Fresh keys are generated on this device and only the
   * public halves go to the server. Throws MustChangePasswordError on first login - call again with `newPassword`.
   */
  async login(serverUrl: string, username: string, password: string, newPassword?: string): Promise<void> {
    username = username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Invalid ID');
    serverUrl = serverUrl.trim().replace(/\/+$/, '');
    const { account, signedPreKey, oneTimePreKeys } = await createAccount(this.store, serverUrl, username);
    try {
      const body: LoginRequest = {
        username,
        password,
        newPassword,
        deviceSecret: account.password,
        identityKey: toBase64(account.identity.pub),
        signedPreKey,
        oneTimePreKeys,
      };
      const res = await this.fetchImpl(`${serverUrl}/v1/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        if (res.status === 403 && text === 'must_change') throw new MustChangePasswordError();
        throw new ApiError(res.status, text || res.statusText);
      }
    } catch (e) {
      await this.store.wipe();
      throw e;
    }
    this.account = account;
    this.contacts = [];
    this.emit('change');
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    await this.http('POST', '/v1/password', { oldPassword, newPassword });
  }

  // ------------------------------------------------------------------ admin: employees

  async createEmployee(username: string, password: string): Promise<void> {
    await this.http('POST', '/v1/admin/users', { username: username.trim().toLowerCase(), password });
  }

  /** New temporary password; the employee must choose their own at next login. */
  async resetEmployeePassword(username: string, password: string): Promise<void> {
    await this.http('POST', `/v1/admin/users/${encodeURIComponent(username)}/password`, { password });
  }

  async removeEmployee(username: string): Promise<void> {
    await this.http('DELETE', `/v1/admin/users/${encodeURIComponent(username)}`);
  }

  // ------------------------------------------------------------------ connection

  connect(): void {
    this.wantOnline = true;
    this.openSocket();
  }

  disconnect(): void {
    this.wantOnline = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  /** Stop all timers (call when the app is closing). */
  dispose(): void {
    this.disconnect();
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    this.emit('change');
  }

  private openSocket() {
    if (!this.account || this.ws) return;
    this.setStatus('connecting');
    const url = this.account.serverUrl.replace(/^http/, 'ws') + '/v1/ws';
    const ws = new this.WS(url);
    this.ws = ws;
    ws.onopen = () =>
      this.sendFrame({ type: 'auth', username: this.account!.username, password: this.account!.password });
    ws.onmessage = (ev: { data?: unknown }) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      void this.onFrame(frame);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      for (const { peer, msgId } of this.pendingSends.values()) this.setMsgStatus(peer, msgId, 'failed');
      this.pendingSends.clear();
      this.setStatus('offline');
      if (this.wantOnline) {
        const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
        this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
      }
    };
  }

  private sendFrame(f: ClientFrame) {
    if (!this.ws || this.ws.readyState !== 1) throw new Error('You are offline');
    this.ws.send(JSON.stringify(f));
  }

  private async onFrame(f: ServerFrame) {
    switch (f.type) {
      case 'ready':
        this.retry = 0;
        this.setStatus('online');
        this.pingTimer = setInterval(() => this.ws?.readyState === 1 && this.sendFrame({ type: 'ping' }), 25_000);
        // Arrives before any queued envelope, so the 📢 badge check below always has the admin list.
        this.isAdmin = !!f.isAdmin;
        this.admins = Array.isArray(f.admins) ? f.admins : [];
        this.emit('change');
        this.maintainKeys(f.preKeyCount).catch((e) => this.emit('error', `Key upload failed: ${e.message}`));
        break;
      case 'envelope':
        await this.withLock(f.from, () => this.handleEnvelope(f.from, f.body, f.ts));
        if (this.ws?.readyState === 1) this.sendFrame({ type: 'ack', id: f.id });
        break;
      case 'sent': {
        const p = this.pendingSends.get(f.ref);
        if (p) {
          this.pendingSends.delete(f.ref);
          this.setMsgStatus(p.peer, p.msgId, 'sent');
        }
        break;
      }
      case 'error':
        if (f.ref) {
          const p = this.pendingSends.get(f.ref);
          if (p) {
            this.pendingSends.delete(f.ref);
            this.setMsgStatus(p.peer, p.msgId, 'failed');
          }
        }
        if (f.code === 'auth') {
          // This device was signed out (account used on another device, password reset login, or removed).
          // Its keys are useless now, so wipe them and go back to the login screen.
          this.wantOnline = false;
          this.emit('error', 'You were logged out. Log in again with your ID and password.');
          await this.wipeLocal();
          break;
        }
        this.emit('error', f.message);
        break;
    }
  }

  private async maintainKeys(serverCount: number) {
    const upload: UploadKeysRequest = {};
    const spk = await maybeRotateSignedPreKey(this.store);
    if (spk) upload.signedPreKey = spk;
    if (serverCount < ONE_TIME_PREKEY_LOW_WATER) {
      upload.oneTimePreKeys = await generateOneTimePreKeys(this.store, ONE_TIME_PREKEY_BATCH);
    }
    if (upload.signedPreKey || upload.oneTimePreKeys) await this.http('PUT', '/v1/keys', upload);
  }

  /** `body` that is a string is sent as-is with `contentType`; otherwise as JSON. `rawText` returns the body text. */
  private async http<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType?: string,
    rawText = false,
  ): Promise<T> {
    const a = this.account;
    if (!a) throw new Error('not registered');
    const isText = typeof body === 'string' && !!contentType;
    const res = await this.fetchImpl(a.serverUrl + path, {
      method,
      headers: {
        'content-type': isText ? contentType! : 'application/json',
        authorization: 'Basic ' + toBase64(utf8(`${a.username}:${a.password}`)),
      },
      body: body === undefined ? undefined : isText ? (body as string) : JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText);
    const text = await res.text();
    if (rawText) return text as T;
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.locks.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.locks.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  // ------------------------------------------------------------------ receiving

  private async handleEnvelope(from: string, body: string, ts: number) {
    let payload: Payload;
    try {
      const wire = JSON.parse(body) as WireMessage;
      const { plaintext, identityStatus } = await this.cipher.decrypt(from, wire);
      if (identityStatus === 'changed') this.onIdentityChanged(from);
      payload = JSON.parse(plaintext) as Payload;
    } catch (e) {
      console.warn('decrypt failed', e);
      this.addContactLocal(from);
      this.addSystem(from, 'A message from this contact could not be decrypted. Try "Reset session".');
      return;
    }
    await this.handlePayload(from, payload, ts);
  }

  private async handlePayload(from: string, p: Payload, ts: number) {
    switch (p.k) {
      case 'text': {
        if (typeof p.text !== 'string' || typeof p.id !== 'string' || p.text.length > MAX_TEXT_LENGTH) return;
        const att = p.att && validPointer(p.att) ? p.att : undefined;
        if (!p.text && !att) return;
        this.addContactLocal(from);
        const expire = typeof p.expire === 'number' && p.expire > 0 ? p.expire : 0;
        if (expire !== (this.timers[from] ?? 0)) await this.applyTimer(from, expire, from);
        const msg: ChatMessage = {
          id: p.id,
          peer: from,
          text: p.text,
          ts,
          outgoing: false,
          expiresAt: expire ? Date.now() + expire * 1000 : undefined,
          // Only trust the announcement flag from real admins.
          broadcast: p.bc === true && this.admins.includes(from) ? true : undefined,
        };
        if (att) {
          const name = safeFileName(att.name);
          msg.attachment = {
            name,
            mime: att.mime,
            size: att.size,
            kind: attachmentKind(att.mime, name),
            state: 'downloading',
          };
          void this.fetchAttachment(msg, att);
        }
        this.chatOf(from).push(msg);
        const isOpen = this.activeChat === from;
        if (!isOpen) this.unread.set(from, (this.unread.get(from) ?? 0) + 1);
        msg.receiptSent = isOpen ? 'read' : 'delivered';
        this.sendPayload(from, { k: 'receipt', ids: [p.id], status: msg.receiptSent }).catch(() => {});
        this.emit('message', msg);
        this.emit('change');
        break;
      }
      case 'receipt': {
        if (!Array.isArray(p.ids)) return;
        const ids = new Set(p.ids);
        for (const m of this.chatOf(from)) {
          if (m.outgoing && ids.has(m.id) && m.status !== 'read') m.status = p.status;
        }
        this.emit('change');
        break;
      }
      case 'timer':
        if (typeof p.expire === 'number') await this.applyTimer(from, Math.max(0, p.expire), from);
        break;
      case 'screenshot':
        this.addSystem(from, `${from} took a screenshot.`);
        break;
      case 'call':
        this.addContactLocal(from);
        this.emit('callSignal', from, p);
        break;
    }
  }

  // ------------------------------------------------------------------ sending

  private async sendPayload(peer: string, payload: Payload, msgId?: string): Promise<void> {
    await this.withLock(peer, async () => {
      if (!this.ws || this.ws.readyState !== 1) throw new Error('You are offline');
      if (!(await this.cipher.hasSession(peer))) {
        const bundle = await this.http<KeyBundleResponse>('GET', `/v1/keys/${encodeURIComponent(peer)}`);
        const status = await this.cipher.initOutgoing(peer, parseBundle(bundle));
        if (status === 'changed') this.onIdentityChanged(peer);
      }
      const wire = await this.cipher.encrypt(peer, pad(JSON.stringify(payload)));
      const ref = newId();
      if (msgId) this.pendingSends.set(ref, { peer, msgId });
      this.sendFrame({ type: 'send', ref, to: peer, body: JSON.stringify(wire) });
    });
  }

  async sendText(peer: string, text: string, opts: { broadcast?: boolean } = {}): Promise<void> {
    await this.sendMessage(peer, text, opts);
  }

  /** Send a photo / PDF / file (with an optional caption). */
  async sendFile(peer: string, file: OutgoingFile, caption = ''): Promise<void> {
    await this.sendMessage(peer, caption, { file });
  }

  private async sendMessage(
    peer: string,
    text: string,
    opts: { broadcast?: boolean; file?: OutgoingFile; uploaded?: AttachmentPointer },
  ): Promise<void> {
    text = text.trim();
    if (!text && !opts.file) return;
    if (text.length > MAX_TEXT_LENGTH) throw new Error('Message too long');
    if (opts.file) checkFile(opts.file);
    const expire = this.timers[peer] ?? 0;
    const msg: ChatMessage = {
      id: newId(),
      peer,
      text,
      ts: Date.now(),
      outgoing: true,
      status: 'sending',
      expiresAt: expire ? Date.now() + expire * 1000 : undefined,
      broadcast: opts.broadcast || undefined,
    };
    if (opts.file) {
      const name = safeFileName(opts.file.name);
      msg.attachment = {
        name,
        mime: opts.file.mime,
        size: opts.file.data.length,
        kind: attachmentKind(opts.file.mime, name),
        state: 'uploading',
        data: opts.file.data,
      };
    }
    this.addContactLocal(peer);
    this.chatOf(peer).push(msg);
    this.emit('change');
    try {
      let att: AttachmentPointer | undefined;
      if (opts.file) {
        att = opts.uploaded ?? (await this.uploadAttachment(opts.file));
        msg.attachment!.state = 'ready';
      }
      await this.sendPayload(
        peer,
        {
          k: 'text',
          id: msg.id,
          text,
          ts: msg.ts,
          expire: expire || undefined,
          bc: opts.broadcast || undefined,
          att,
        },
        msg.id,
      );
    } catch (e) {
      msg.status = 'failed';
      if (msg.attachment && msg.attachment.state === 'uploading') msg.attachment.state = 'failed';
      this.emit('change');
      throw e;
    }
  }

  /** Encrypt locally, upload only ciphertext. Returns the pointer that goes inside the E2E message. */
  private async uploadAttachment(file: OutgoingFile): Promise<AttachmentPointer> {
    const { ciphertext, key, digest } = encryptAttachment(file.data);
    const { id } = await this.http<{ id: string }>('POST', '/v1/attachments', toBase64(ciphertext), 'text/plain');
    return {
      id,
      key: toBase64(key),
      digest: toBase64(digest),
      name: safeFileName(file.name),
      mime: /^[\w.+-]{1,64}\/[\w.+-]{1,100}$/.test(file.mime) ? file.mime : 'application/octet-stream',
      size: file.data.length,
    };
  }

  /** Download + decrypt into memory. Nothing is ever written to disk. */
  private async fetchAttachment(msg: ChatMessage, p: AttachmentPointer) {
    try {
      const b64 = await this.http<string>('GET', `/v1/attachments/${p.id}`, undefined, undefined, true);
      const data = decryptAttachment(fromBase64(b64.trim()), fromBase64(p.key), fromBase64(p.digest));
      if (data.length !== p.size) throw new Error('size mismatch');
      if (msg.attachment) {
        msg.attachment.data = data;
        msg.attachment.state = 'ready';
      }
    } catch (e) {
      console.warn('attachment download failed', e);
      if (msg.attachment) msg.attachment.state = 'failed';
    }
    this.emit('change');
  }

  /** Admin only: every account incl. employees who haven't logged in yet (the server refuses non-admins). */
  async listAllUsers(): Promise<AdminUser[]> {
    const { users } = await this.http<{ users: AdminUser[] }>('GET', '/v1/admin/users');
    return users;
  }

  /** Admin only: employees who can receive messages right now (logged in at least once). */
  async listActiveRecipients(): Promise<string[]> {
    return (await this.listAllUsers())
      .filter((u) => u.active && u.username !== this.account?.username)
      .map((u) => u.username);
  }

  /**
   * Admin only: send an announcement to every employee. Each copy is encrypted separately with that
   * person's own Double Ratchet session, so the server still cannot read it. Replies arrive as normal 1:1 chats.
   */
  async broadcast(text: string, file?: OutgoingFile): Promise<BroadcastResult> {
    if (!this.isAdmin) throw new Error('Only admins can send announcements');
    if (!text.trim() && !file) throw new Error('Message is empty');
    if (file) checkFile(file);
    const users = await this.listActiveRecipients();
    // Upload the encrypted file once; every employee gets the key inside their own encrypted message.
    const uploaded = file ? await this.uploadAttachment(file) : undefined;
    const results = await Promise.allSettled(
      users.map((u) => this.sendMessage(u, text, { broadcast: true, file, uploaded })),
    );
    const failed = users.filter((_, i) => results[i]!.status === 'rejected');
    return { sent: users.length - failed.length, failed };
  }

  sendCallSignal(peer: string, signal: CallSignal): Promise<void> {
    return this.sendPayload(peer, signal);
  }

  /** Mobile calls this when the OS reports a screenshot (iOS can detect but not block it). */
  notifyScreenshot(peer: string): void {
    this.addSystem(peer, 'You took a screenshot.');
    this.sendPayload(peer, { k: 'screenshot' }).catch(() => {});
  }

  async setDisappearingTimer(peer: string, seconds: number): Promise<void> {
    await this.applyTimer(peer, seconds, null);
    await this.sendPayload(peer, { k: 'timer', expire: seconds });
  }

  getDisappearingTimer(peer: string): number {
    return this.timers[peer] ?? 0;
  }

  private async applyTimer(peer: string, seconds: number, by: string | null) {
    if (seconds) this.timers[peer] = seconds;
    else delete this.timers[peer];
    await this.store.setSetting('timers', this.timers);
    const who = by ?? 'You';
    this.addSystem(
      peer,
      seconds ? `${who} set disappearing messages to ${formatDuration(seconds)}.` : `${who} turned off disappearing messages.`,
    );
  }

  // ------------------------------------------------------------------ chats & contacts

  getMessages(peer: string): ChatMessage[] {
    return this.chats.get(peer) ?? [];
  }

  getUnread(peer: string): number {
    return this.unread.get(peer) ?? 0;
  }

  /** Short text for chat lists / notifications. */
  static preview(m: ChatMessage): string {
    if (m.attachment) {
      const label = m.attachment.kind === 'image' ? 'Photo' : m.attachment.kind === 'pdf' ? 'PDF' : 'File';
      return m.text ? `${label}: ${m.text}` : label;
    }
    return m.text;
  }

  lastMessage(peer: string): ChatMessage | undefined {
    const c = this.chats.get(peer);
    return c?.[c.length - 1];
  }

  setActiveChat(peer: string | null): void {
    this.activeChat = peer;
    if (!peer) return;
    this.unread.delete(peer);
    const ids = this.getMessages(peer)
      .filter((m) => !m.outgoing && !m.system && m.receiptSent !== 'read')
      .map((m) => {
        m.receiptSent = 'read';
        return m.id;
      });
    if (ids.length) this.sendPayload(peer, { k: 'receipt', ids, status: 'read' }).catch(() => {});
    this.emit('change');
  }

  async userExists(username: string): Promise<boolean> {
    try {
      await this.http('GET', `/v1/users/${encodeURIComponent(username)}`);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return false;
      throw e;
    }
  }

  async addContact(username: string): Promise<void> {
    username = username.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Invalid username');
    if (username === this.account?.username) throw new Error("That's you");
    if (!(await this.userExists(username))) throw new Error('User not found');
    this.addContactLocal(username);
  }

  private addContactLocal(username: string) {
    if (this.contacts.includes(username)) return;
    this.contacts = [...this.contacts, username];
    void this.store.saveContacts(this.contacts);
    this.emit('change');
  }

  async removeContact(username: string): Promise<void> {
    this.contacts = this.contacts.filter((c) => c !== username);
    this.chats.delete(username);
    this.unread.delete(username);
    await this.store.saveContacts(this.contacts);
    this.emit('change');
  }

  clearChat(peer: string): void {
    this.chats.delete(peer);
    this.emit('change');
  }

  /** Throw away sessions with a peer; the next message starts a fresh X3DH handshake. */
  async resetSession(peer: string): Promise<void> {
    await this.withLock(peer, () => this.store.deleteSessions(peer));
    this.addSystem(peer, 'Secure session reset.');
  }

  // ------------------------------------------------------------------ verification

  async getSafetyNumber(peer: string): Promise<{ number: string; verified: boolean } | null> {
    const their = await this.store.getIdentity(peer);
    if (!their || !this.account) return null;
    return {
      number: safetyNumber(this.account.username, this.account.identity.pub, peer, their.key),
      verified: their.verified,
    };
  }

  async setVerified(peer: string, verified: boolean): Promise<void> {
    const their = await this.store.getIdentity(peer);
    if (!their) return;
    await this.store.saveIdentity(peer, { ...their, verified });
    this.addSystem(peer, verified ? 'You marked this contact as verified.' : 'Verification cleared.');
  }

  private onIdentityChanged(peer: string) {
    this.addSystem(peer, `Your safety number with ${peer} changed. Verify it before sending anything sensitive.`);
    this.emit('identityChanged', peer);
  }

  // ------------------------------------------------------------------ calls / account

  getIceConfig(): Promise<IceConfigResponse> {
    return this.http<IceConfigResponse>('GET', '/v1/turn');
  }

  async deleteAccount(): Promise<void> {
    try {
      await this.http('DELETE', '/v1/account');
    } finally {
      await this.wipeLocal();
    }
  }

  /** Log out on this device: delete keys + in-memory chats. The account stays; log in again with ID + password. */
  async logout(): Promise<void> {
    await this.wipeLocal();
  }

  private async wipeLocal(): Promise<void> {
    this.disconnect();
    await this.store.wipe();
    this.account = null;
    this.contacts = [];
    this.chats.clear();
    this.unread.clear();
    this.activeChat = null;
    this.isAdmin = false;
    this.emit('change');
  }

  // ------------------------------------------------------------------ helpers

  private chatOf(peer: string): ChatMessage[] {
    let c = this.chats.get(peer);
    if (!c) this.chats.set(peer, (c = []));
    return c;
  }

  private addSystem(peer: string, text: string) {
    this.chatOf(peer).push({ id: newId(), peer, text, ts: Date.now(), outgoing: false, system: true });
    this.emit('change');
  }

  private setMsgStatus(peer: string, id: string, status: ChatMessage['status']) {
    const m = this.chats.get(peer)?.find((x) => x.id === id);
    if (m && m.status !== 'delivered' && m.status !== 'read') {
      m.status = status;
      this.emit('change');
    }
  }

  private sweepExpired() {
    const now = Date.now();
    let changed = false;
    for (const [peer, list] of this.chats) {
      const kept = list.filter((m) => !m.expiresAt || m.expiresAt > now);
      if (kept.length !== list.length) {
        for (const m of list) {
          if (m.expiresAt && m.expiresAt <= now) {
            // drop references to content (and wipe file bytes) so nothing lingers in memory
            m.text = '';
            m.attachment?.data?.fill(0);
            if (m.attachment) m.attachment.data = undefined;
          }
        }
        this.chats.set(peer, kept);
        changed = true;
      }
    }
    if (changed) this.emit('change');
  }
}

export function formatDuration(s: number): string {
  if (s < 60) return `${s} seconds`;
  if (s < 3600) return `${Math.round(s / 60)} minutes`;
  if (s < 86400) return `${Math.round(s / 3600)} hours`;
  return `${Math.round(s / 86400)} days`;
}
