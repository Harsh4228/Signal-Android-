import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, promises as fs } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DEFAULT_POLICY,
  GROUP_ID_RE,
  MAX_ATTACHMENT_BYTES,
  MAX_GROUP_MEMBERS,
  MAX_DEPARTMENT,
  MAX_DEPARTMENTS,
  MAX_AVATAR_BYTES,
  AVATAR_MIMES,
  MAX_GROUP_NAME,
  MAX_EMAIL,
  MAX_NAME,
  MAX_PHONE,
  INVITE_TTL_MS,
  EMAIL_RE,
  PHONE_RE,
  MAX_PRODUCT_DESC,
  MAX_PRODUCT_NAME,
  MAX_PRODUCT_PRICE,
  MIN_PASSWORD_LENGTH,
  USERNAME_RE,
  type AdminStats,
  type AdminUser,
  type AvatarResponse,
  type AuditEntry,
  type GroupInfo,
  type Policy,
  type Presence,
  type Product,
  type UserProfile,
  type InviteResponse,
  type JoinRequest,
  type LoginRequest,
  type PublicConfig,
  type PushKind,
  type PushTokenRequest,
  fromBase64,
  generateIdentityKeyPair,
  isSealed,
  issueCertificate,
  toBase64,
  verifyPreKeySignature,
  type ClientFrame,
  type IceConfigResponse,
  type KeyBundleResponse,
  type MeResponse,
  type RegisterRequest,
  type ServerFrame,
  type UploadKeysRequest,
} from '@meetme/core';
import { LocalBus, type Bus, type BusEvent } from './bus';
import { isActive, isOnlineRow, openSqlite, type Db, type GroupRow, type ProductPhoto, type ProductRow, type UserRow } from './db';
import type { PushSender } from './push';

export interface ServerConfig {
  /** SQLite file (used when no Postgres db is passed in). Attachments go next to it unless attachmentsDir is set. */
  dbPath: string;
  attachmentsDir?: string;
  stunUrls: string[];
  turnUrls: string[];
  turnSecret?: string;
  trustProxy: boolean;
  /** Usernames allowed to manage employees and send broadcasts. */
  adminUsers: string[];
  /** Anyone may create an account. When false only admins self-register; employees get accounts from an admin. */
  openRegistration: boolean;
  /** How long a message may wait unacknowledged before a wake-up push is sent (ms). */
  pushDelayMs?: number;
}

const MAX_BODY = 64 * 1024;
const MAX_ENVELOPE = 256 * 1024;
/** Encrypted attachments are sent as base64 text (works the same on every client platform). */
const MAX_ATTACHMENT_B64 = Math.ceil(((MAX_ATTACHMENT_BYTES + 64) * 4) / 3) + 4;
const ATTACHMENT_TTL_MS = 14 * 24 * 3600 * 1000;
const MAX_QUEUE = 5000;
const QUEUE_TTL_MS = 30 * 24 * 3600 * 1000;
const AUTH_TIMEOUT_MS = 5000;
const SEALED_PATH = new RegExp('^/v1/sealed/([a-z0-9_.]{3,32})$');

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- validation helpers

function b64Key(v: unknown, len: number, what: string): string {
  if (typeof v !== 'string') throw new HttpError(400, `${what} missing`);
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(v);
  } catch {
    throw new HttpError(400, `${what} invalid`);
  }
  if (bytes.length !== len) throw new HttpError(400, `${what} wrong length`);
  return v;
}

const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) < 2 ** 31;

function checkSpk(identityKey: string, spk: unknown) {
  const s = spk as { id?: unknown; pub?: unknown; sig?: unknown } | undefined;
  if (!s || !isId(s.id)) throw new HttpError(400, 'signedPreKey invalid');
  const pub = b64Key(s.pub, 32, 'signedPreKey.pub');
  const sig = b64Key(s.sig, 64, 'signedPreKey.sig');
  if (!verifyPreKeySignature(fromBase64(identityKey), fromBase64(pub), fromBase64(sig))) {
    throw new HttpError(400, 'signedPreKey signature does not verify');
  }
  return { id: s.id, pub, sig };
}

function checkOpks(list: unknown) {
  if (!Array.isArray(list) || list.length > 200) throw new HttpError(400, 'oneTimePreKeys invalid');
  return list.map((k: { id?: unknown; pub?: unknown }) => {
    if (!isId(k?.id)) throw new HttpError(400, 'oneTimePreKey id invalid');
    return { id: k.id, pub: b64Key(k.pub, 32, 'oneTimePreKey.pub') };
  });
}

const BANNED_MESSAGE = 'Your account is suspended. Contact your admin.';

const toGroupInfo = (g: GroupRow): GroupInfo => ({
  id: g.id,
  name: g.name,
  members: g.members,
  senders: g.senders,
  createdBy: g.created_by,
  createdAt: Number(g.created_at),
});

function checkGroupName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_GROUP_NAME) throw new HttpError(400, `Group name: 1-${MAX_GROUP_NAME} characters`);
  return name;
}

function checkDepartmentName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_DEPARTMENT) throw new HttpError(400, `Department name: 1-${MAX_DEPARTMENT} characters`);
  return name;
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
const sortNames = (list: string[]) => list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

/** Who may send: null/undefined = every member; otherwise a list, kept to people in the group. */
function checkSenders(v: unknown, members: string[]): string[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new HttpError(400, 'senders must be a list of IDs or null');
  return [...new Set(v.map((u) => String(u).trim().toLowerCase()))].filter((u) => members.includes(u));
}

function checkMemberList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > MAX_GROUP_MEMBERS) throw new HttpError(400, `Members: up to ${MAX_GROUP_MEMBERS}`);
  const list = [...new Set(v.map((u) => String(u).trim().toLowerCase()))];
  for (const u of list) if (!USERNAME_RE.test(u)) throw new HttpError(400, `Invalid ID: ${u}`);
  return list.sort();
}

function checkNewPassword(pw: unknown, old?: string) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH || pw.length > 128) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (old !== undefined && pw === old) throw new HttpError(400, 'Choose a password different from the old one');
}

/** Checks the file really starts like the image type it claims (no SVG/HTML posing as a photo). */
function looksLikeImage(b: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

// ---------------------------------------------------------------- password hashing

function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(pw: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(pw, Buffer.from(salt, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------- rate limiting

class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  allow(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      if (this.hits.size > 50_000) this.prune(now);
      return true;
    }
    return ++h.n <= this.max;
  }
  /** Check without counting a hit. */
  isBlocked(key: string): boolean {
    const h = this.hits.get(key);
    return !!h && h.reset >= Date.now() && h.n >= this.max;
  }
  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
  }
}

// ---------------------------------------------------------------- server

export function createMeetMeServer(config: ServerConfig, deps: { db?: Db; bus?: Bus; push?: PushSender | null } = {}) {
  const db: Db = deps.db ?? openSqlite(config.dbPath);
  const bus: Bus = deps.bus ?? new LocalBus();
  const push = deps.push ?? null;

  // Sealed sender: the key that signs sender certificates. Kept in the database so every instance
  // uses the same one (and clients keep trusting it across restarts).
  const certKey = db
    .getOrCreateMeta('sender_cert_key', () => {
      const k = generateIdentityKeyPair();
      return JSON.stringify([toBase64(k.priv), toBase64(k.pub)]);
    })
    .then((v) => {
      const [priv, pub] = JSON.parse(v) as [string, string];
      return { priv: fromBase64(priv), pub: fromBase64(pub) };
    });
  certKey.catch((e) => console.error('could not load the sender certificate key', e));
  const sealedLimit = new RateLimiter(600, 60_000);
  const online = new Map<string, WebSocket>();
  const authCache = new Map<string, { digest: string; until: number }>();
  const registerLimit = new RateLimiter(10, 3600_000);
  const authFailLimit = new RateLimiter(20, 60_000);
  const requestLimit = new RateLimiter(600, 60_000);
  const sendLimit = new RateLimiter(1200, 60_000);

  const clientIp = (req: http.IncomingMessage) =>
    (config.trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim()) ||
    req.socket.remoteAddress ||
    'unknown';

  async function authenticate(username: unknown, password: unknown, ip: string): Promise<string> {
    if (typeof username !== 'string' || typeof password !== 'string' || !USERNAME_RE.test(username)) {
      throw new HttpError(401, 'unauthorized');
    }
    if (authFailLimit.isBlocked(ip)) throw new HttpError(429, 'too many attempts');
    const digest = createHash('sha256').update(password).digest('base64');
    const cached = authCache.get(username);
    if (cached && cached.until > Date.now() && cached.digest === digest) return username;
    const user = await db.getUser(username);
    // API calls are authenticated with the DEVICE secret, never with the human login password.
    if (!user || !user.device_hash || !verifyPassword(password, user.device_hash)) {
      authFailLimit.allow(ip);
      throw new HttpError(401, 'unauthorized');
    }
    // Banning kicks the user, which also clears this cache, so a ban takes effect at once.
    if (user.banned) throw new HttpError(403, BANNED_MESSAGE);
    authCache.set(username, { digest, until: Date.now() + 10 * 60_000 });
    return username;
  }

  let closing = false;
  /** Online / last seen bookkeeping; skipped while shutting down (the database is closing). */
  const setPresence = (u: string, onlineAt: number | null) => {
    if (!closing) void db.setPresence(u, onlineAt, Date.now()).catch((e) => console.error('presence failed', e));
  };

  const isOnline = (u: UserRow) => online.has(u.username) || isOnlineRow(u);

  async function notifyGroupsOf(user: string) {
    const groups = await db.groupsOf(user);
    if (groups.length) await notify([...new Set(groups.flatMap((g) => g.members))], 'groups');
  }

  async function existingMembers(list: string[]): Promise<string[]> {
    const known = new Set((await db.listUsers()).map((u) => u.username));
    const missing = list.filter((u) => !known.has(u));
    if (missing.length) throw new HttpError(400, `Unknown ID: ${missing.join(', ')}`);
    return list;
  }

  /**
   * Saving files out of the app was removed: everyone may share files to other chats, nobody may take them
   * outside. Always false, so app versions that still read this flag hide their Save / Share-outside buttons.
   * (The admin endpoint that set it still works for those older apps, but no longer changes anything.)
   */
  const canShare = (_u: UserRow) => false;

  /** The admin's department list, plus any name still on a user (so nothing in use goes missing). */
  async function getDepartments(): Promise<string[]> {
    let stored: string[] = [];
    try {
      const v = JSON.parse((await db.getMeta('departments')) ?? '[]') as unknown;
      if (Array.isArray(v)) stored = v.filter((d): d is string => typeof d === 'string');
    } catch {
      // unreadable value: start from the names in use
    }
    for (const u of await db.listUsers()) {
      for (const d of u.departments) if (!stored.some((s) => sameName(s, d))) stored.push(d);
    }
    return sortNames(stored);
  }
  const saveDepartments = (list: string[]) => db.setMeta('departments', JSON.stringify(sortNames(list)));

  /** A user's departments: missing or [] = none; each must be on the department list. Returns them A-Z, once each. */
  async function checkDepartments(v: unknown): Promise<string[]> {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > MAX_DEPARTMENTS) throw new HttpError(400, 'departments must be a list of names');
    const list = await getDepartments();
    const out: string[] = [];
    for (const item of v) {
      const name = checkDepartmentName(item);
      const known = list.find((d) => sameName(d, name));
      if (!known) throw new HttpError(400, `Unknown department "${name}". Add it under Departments first.`);
      if (!out.includes(known)) out.push(known);
    }
    return sortNames(out);
  }

  /** Rename (to = name) or remove (to = null) a department on everyone who has it. */
  async function replaceDepartment(from: string, to: string | null) {
    for (const u of await db.listUsers()) {
      if (!u.departments.includes(from)) continue;
      const next = u.departments.filter((d) => d !== from);
      if (to && !next.includes(to)) next.push(to);
      await db.setDepartments(u.username, sortNames(next));
    }
  }

  // A server without admins has nobody to switch protections on or off, so there users keep full control
  // of their own history; with an admin, history is protected until the admin allows clearing it.
  const defaultPolicy: Policy = { ...DEFAULT_POLICY, allowClearHistory: config.adminUsers.length === 0 };

  async function getPolicy(): Promise<Policy> {
    try {
      return { ...defaultPolicy, ...(JSON.parse((await db.getMeta('policy')) ?? '{}') as Partial<Policy>) };
    } catch {
      return defaultPolicy;
    }
  }

  /** A user's full name ('' = none, the ID is shown). */
  function checkName(v: unknown): string {
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string' || v.trim().length > MAX_NAME || /[\u0000-\u001f\u007f‪-‮⁦-⁩]/.test(v)) {
      throw new HttpError(400, `Name: at most ${MAX_NAME} characters`);
    }
    return v.trim().replace(/\s+/g, ' ');
  }

  /** A profile photo: { mime, data (base64) }, JPEG / PNG / WebP up to 2 MB, and really an image. */
  function checkPhoto(v: unknown): { mime: string; data: string } {
    const p = (v ?? {}) as { mime?: unknown; data?: unknown };
    if (typeof p.mime !== 'string' || !(AVATAR_MIMES as readonly string[]).includes(p.mime)) {
      throw new HttpError(400, 'Photo must be JPEG, PNG or WebP');
    }
    if (typeof p.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) throw new HttpError(400, 'invalid photo');
    const bytes = Buffer.from(p.data, 'base64');
    if (bytes.length > MAX_AVATAR_BYTES) throw new HttpError(413, 'Photo too large (max 2 MB)');
    if (!looksLikeImage(bytes, p.mime)) throw new HttpError(400, 'That file is not a valid photo');
    return { mime: p.mime, data: p.data };
  }

  /** A fresh one-time QR invite for a user; the secret is only returned here (the database keeps a hash). */
  async function newInvite(username: string): Promise<InviteResponse> {
    const token = randomBytes(32).toString('base64url');
    const expires = Date.now() + INVITE_TTL_MS;
    await db.setInvite(username, { hash: hashPassword(token), expires });
    return { username, token, expires };
  }

  /** Optional work mobile number and email for a user ('' = none). */
  function checkContactInfo(phone: unknown, email: unknown): { phone: string; email: string } {
    const p = phone === undefined || phone === null ? '' : typeof phone === 'string' ? phone.trim() : null;
    const e = email === undefined || email === null ? '' : typeof email === 'string' ? email.trim().toLowerCase() : null;
    if (p === null || (p && (p.length > MAX_PHONE || !PHONE_RE.test(p)))) {
      throw new HttpError(400, 'Mobile number: digits only, optionally starting with + (6-20 characters)');
    }
    if (e === null || (e && (e.length > MAX_EMAIL || !EMAIL_RE.test(e)))) throw new HttpError(400, 'That email address is not valid');
    return { phone: p, email: e };
  }

  const MAX_PRODUCTS = 500;

  // Products from before catalogs were per user (an admin made them) become the first admin's catalog.
  if (config.adminUsers[0]) void db.adoptOrphanProducts(config.adminUsers[0]).catch((e) => console.error('catalog migration failed', e));

  const toProductInfo = (p: ProductRow): Product => ({
    id: p.id,
    owner: p.owner,
    name: p.name,
    price: p.price,
    description: p.description,
    photo: p.photo_ver,
    updatedAt: p.updated_at,
  });

  /** Checks an admin's product form. `creating`: the name is required; otherwise missing fields keep `old`. */
  function parseProductInput(raw: unknown, creating: boolean, old?: ProductRow) {
    const body = (raw ?? {}) as Record<string, unknown>;
    const text = (key: string, max: number, current: string): string => {
      const v = body[key];
      if (v === undefined) return current;
      if (typeof v !== 'string' || v.trim().length > max) throw new HttpError(400, `${key}: at most ${max} characters`);
      return v.trim();
    };
    const name = text('name', MAX_PRODUCT_NAME, old?.name ?? '');
    if (!name || (creating && body.name === undefined)) throw new HttpError(400, 'The product needs a name');
    const fields = {
      name,
      price: text('price', MAX_PRODUCT_PRICE, old?.price ?? ''),
      description: text('description', MAX_PRODUCT_DESC, old?.description ?? ''),
    };
    let photo: (ProductPhoto & { ver: number }) | null | undefined;
    if (body.photo === null) photo = null;
    else if (body.photo !== undefined) {
      const p = body.photo as { mime?: unknown; data?: unknown };
      if (typeof p.mime !== 'string' || !(AVATAR_MIMES as readonly string[]).includes(p.mime)) {
        throw new HttpError(400, 'Photo must be JPEG, PNG or WebP');
      }
      if (typeof p.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.data)) throw new HttpError(400, 'invalid photo');
      const bytes = Buffer.from(p.data, 'base64');
      if (bytes.length > MAX_AVATAR_BYTES) throw new HttpError(413, 'Photo too large (max 2 MB)');
      if (!looksLikeImage(bytes, p.mime)) throw new HttpError(400, 'That file is not a valid photo');
      photo = { mime: p.mime, data: p.data, ver: Date.now() };
    }
    return { fields, photo };
  }

  async function audit(actor: string, action: string, target: string, detail = '') {
    await db.addAudit({ ts: Date.now(), actor, action, target, detail }).catch((e) => console.error('audit failed', e));
  }

  /** Ask connected users (null = everyone) to reload groups / policy, on every server instance. */
  async function notify(users: string[] | null, what: 'groups' | 'policy') {
    for (const [u, ws] of online) if (!users || users.includes(u)) frame(ws, { type: 'refresh', what });
    await bus.publish({ type: 'refresh', users, what }).catch((e) => console.error('bus publish failed', e));
  }

  function basicAuth(req: http.IncomingMessage): Promise<string> {
    const h = req.headers.authorization ?? '';
    if (!h.startsWith('Basic ')) throw new HttpError(401, 'unauthorized');
    const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    return authenticate(decoded.slice(0, i), decoded.slice(i + 1), clientIp(req));
  }

  async function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > limit) throw new HttpError(413, 'body too large');
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function readJson(req: http.IncomingMessage, limit = MAX_BODY): Promise<unknown> {
    const text = await readBody(req, limit);
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(400, 'invalid json');
    }
  }

  // Attachments: ciphertext only (the key is inside the end-to-end encrypted message).
  const attachmentsDir = config.attachmentsDir ?? join(dirname(config.dbPath), 'attachments');
  mkdirSync(attachmentsDir, { recursive: true });
  const attachmentFile = (id: string) => join(attachmentsDir, `${id}.bin`);
  const uploadLimit = new RateLimiter(120, 3600_000);

  function iceConfig(username: string): IceConfigResponse {
    const iceServers: IceConfigResponse['iceServers'] = [];
    if (config.turnUrls.length && config.turnSecret) {
      // coturn "use-auth-secret" short-lived credentials
      const user = `${Math.floor(Date.now() / 1000) + 12 * 3600}:${username}`;
      const credential = createHmac('sha1', config.turnSecret).update(user).digest('base64');
      iceServers.push({ urls: config.turnUrls, username: user, credential });
      return { iceServers, relayOnly: true };
    }
    if (config.stunUrls.length) iceServers.push({ urls: config.stunUrls });
    return { iceServers, relayOnly: false };
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };

    if (!requestLimit.allow(clientIp(req))) throw new HttpError(429, 'slow down');

    if (method === 'GET' && path === '/health') return send(200, { ok: true });
    if (method === 'GET' && path === '/v1/config') {
      const pub: PublicConfig = { openRegistration: config.openRegistration, certKey: toBase64((await certKey).pub) };
      return send(200, pub);
    }

    if (method === 'POST' && path === '/v1/login') {
      const ip = clientIp(req);
      if (authFailLimit.isBlocked(ip)) throw new HttpError(429, 'Too many attempts, try again later');
      const body = (await readJson(req)) as Partial<LoginRequest>;
      const user = typeof body.username === 'string' ? await db.getUser(body.username) : undefined;
      if (!user || typeof body.password !== 'string' || !verifyPassword(body.password, user.pass_hash)) {
        authFailLimit.allow(ip);
        throw new HttpError(401, 'Wrong ID or password');
      }
      if (user.banned) throw new HttpError(403, BANNED_MESSAGE);
      let newHash: string | null = null;
      if (user.must_change) {
        if (body.newPassword === undefined) throw new HttpError(403, 'must_change');
        checkNewPassword(body.newPassword, body.password);
        newHash = hashPassword(body.newPassword);
      }
      if (typeof body.deviceSecret !== 'string' || body.deviceSecret.length < 32 || body.deviceSecret.length > 128) {
        throw new HttpError(400, 'invalid device secret');
      }
      const identityKey = b64Key(body.identityKey, 32, 'identityKey');
      const spk = checkSpk(identityKey, body.signedPreKey);
      const opks = checkOpks(body.oneTimePreKeys ?? []);
      await db.activate(user.username, { deviceHash: hashPassword(body.deviceSecret), identityKey, spk }, opks);
      if (newHash) await db.setPassword(user.username, newHash, false);
      await kick(user.username, 4004, 'logged in on another device');
      await notifyGroupsOf(user.username); // new keys: group members start fresh sessions
      return send(200, { ok: true });
    }

    // Accept a QR invite: the admin made the account (name, photo, mobile, email); the person only chooses
    // their own password here, and this device's keys are registered. The invite works once.
    if (method === 'POST' && path === '/v1/join') {
      const ip = clientIp(req);
      if (authFailLimit.isBlocked(ip)) throw new HttpError(429, 'Too many attempts, try again later');
      const body = (await readJson(req)) as Partial<JoinRequest>;
      const user = typeof body.username === 'string' ? await db.getUser(body.username) : undefined;
      const valid =
        !!user?.invite_hash &&
        Number(user.invite_expires) > Date.now() &&
        typeof body.token === 'string' &&
        body.token.length >= 32 &&
        body.token.length <= 128 &&
        verifyPassword(body.token, user.invite_hash);
      if (!valid) {
        authFailLimit.allow(ip);
        throw new HttpError(401, 'This QR code is not valid any more. Ask your admin for a new one.');
      }
      if (user!.banned) throw new HttpError(403, BANNED_MESSAGE);
      checkNewPassword(body.newPassword);
      if (typeof body.deviceSecret !== 'string' || body.deviceSecret.length < 32 || body.deviceSecret.length > 128) {
        throw new HttpError(400, 'invalid device secret');
      }
      const identityKey = b64Key(body.identityKey, 32, 'identityKey');
      const spk = checkSpk(identityKey, body.signedPreKey);
      const opks = checkOpks(body.oneTimePreKeys ?? []);
      await db.activate(user!.username, { deviceHash: hashPassword(body.deviceSecret), identityKey, spk }, opks);
      await db.setPassword(user!.username, hashPassword(body.newPassword as string), false);
      await db.setInvite(user!.username, null);
      await kick(user!.username, 4004, 'logged in on another device');
      await notifyGroupsOf(user!.username);
      await audit(user!.username, 'user.join', user!.username, 'joined with a QR invite');
      return send(200, { ok: true });
    }

    if (method === 'POST' && path === '/v1/register') {
      if (!registerLimit.allow(clientIp(req))) throw new HttpError(429, 'too many registrations');
      const body = (await readJson(req)) as Partial<RegisterRequest>;
      if (typeof body.username !== 'string' || !USERNAME_RE.test(body.username)) {
        throw new HttpError(400, 'invalid username');
      }
      if (!config.openRegistration && !config.adminUsers.includes(body.username)) {
        throw new HttpError(403, 'Sign-up is closed. Ask your admin for an ID and password, then use Log in.');
      }
      if (typeof body.password !== 'string' || body.password.length < 32 || body.password.length > 128) {
        throw new HttpError(400, 'invalid password');
      }
      const identityKey = b64Key(body.identityKey, 32, 'identityKey');
      const spk = checkSpk(identityKey, body.signedPreKey);
      const opks = checkOpks(body.oneTimePreKeys ?? []);
      if (await db.getUser(body.username)) throw new HttpError(409, 'username taken');
      await db.createUser({ username: body.username, deviceHash: hashPassword(body.password), identityKey, spk }, opks);
      return send(200, { ok: true });
    }

    // Sealed sender: NO login, so the server never learns who is sending. Allowed only with the
    // recipient's delivery key, which they share with their contacts inside encrypted messages.
    let sm: RegExpMatchArray | null;
    if (method === 'POST' && (sm = path.match(SEALED_PATH))) {
      if (!sealedLimit.allow(clientIp(req))) throw new HttpError(429, 'slow down');
      const to = sm[1]!;
      const key = req.headers['x-delivery-key'];
      const target = await db.getUser(to);
      let ok = false;
      if (typeof key === 'string' && target?.access_key_hash && isActive(target) && !target.banned) {
        const given = createHash('sha256').update(Buffer.from(key, 'base64')).digest();
        const stored = Buffer.from(target.access_key_hash, 'base64');
        ok = stored.length === given.length && timingSafeEqual(given, stored);
      }
      // Same answer for "no such user" and "wrong key", so this can't be used to probe usernames.
      if (!ok) throw new HttpError(401, 'unauthorized');
      const body = await readBody(req, MAX_ENVELOPE);
      if (!isSealed(body)) throw new HttpError(400, 'not a sealed message');
      if ((await db.queueSize(to)) >= MAX_QUEUE) throw new HttpError(507, "Recipient's inbox is full");
      const ts = Date.now();
      const id = await db.enqueue(to, '', body, ts);
      await dispatch(to, { id, sender: '', body, ts });
      const hint = req.headers['x-push'];
      if (hint === 'message' || hint === 'call') schedulePush(to, id, hint);
      return send(200, { ts });
    }

    // Everything below needs authentication.
    const me = await basicAuth(req);

    let m: RegExpMatchArray | null;
    if (method === 'GET' && path === '/v1/keys/count') {
      return send(200, { count: await db.countOneTimePreKeys(me) });
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/keys\/([a-z0-9_.]{3,32})$/))) {
      const user = await db.getUser(m[1]!);
      if (!user) throw new HttpError(404, 'user not found');
      if (!isActive(user)) throw new HttpError(409, `${user.username} has not logged in yet`);
      if (user.banned) throw new HttpError(409, `${user.username} is suspended`);
      const opk = await db.takeOneTimePreKey(user.username);
      const bundle: KeyBundleResponse = {
        identityKey: user.identity_key,
        signedPreKey: { id: user.spk_id, pub: user.spk_pub, sig: user.spk_sig },
        oneTimePreKey: opk,
      };
      return send(200, bundle);
    }
    if (method === 'PUT' && path === '/v1/keys') {
      const body = (await readJson(req)) as UploadKeysRequest;
      const user = (await await db.getUser(me))!;
      if (body.signedPreKey) await db.setSignedPreKey(me, checkSpk(user.identity_key, body.signedPreKey));
      if (body.oneTimePreKeys) await db.addOneTimePreKeys(me, checkOpks(body.oneTimePreKeys));
      return send(204);
    }
    // Username search for "start a chat": prefix match over people you can actually message.
    if (method === 'GET' && path === '/v1/users') {
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      if (!/^[a-z0-9_.]{1,32}$/.test(q)) return send(200, { users: [] });
      const users = (await db.listUsers())
        .filter((u) => u.username !== me && u.username.startsWith(q) && isActive(u) && !u.banned)
        .slice(0, 20)
        .map((u) => u.username);
      return send(200, { users });
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/users\/([a-z0-9_.]{3,32})$/))) {
      const u = await db.getUser(m[1]!);
      if (!u) throw new HttpError(404, 'user not found');
      // The company directory: department and the work contact details the admin entered.
      const profile: UserProfile & { exists: true } = {
        exists: true,
        username: u.username,
        name: u.display_name,
        active: isActive(u),
        departments: u.departments,
        phone: u.phone,
        email: u.email,
      };
      return send(200, profile);
    }
    if (method === 'GET' && path === '/v1/turn') return send(200, iceConfig(me));
    if (method === 'GET' && path === '/v1/certificate') {
      const user = (await db.getUser(me))!;
      return send(200, { certificate: issueCertificate(await certKey, me, user.identity_key) });
    }
    if (method === 'PUT' && path === '/v1/delivery-key') {
      const body = (await readJson(req)) as { hash?: unknown };
      b64Key(body.hash, 32, 'hash');
      await db.setAccessKeyHash(me, body.hash as string);
      return send(204);
    }
    if (path === '/v1/push' && (method === 'PUT' || method === 'DELETE')) {
      let token: string | null = null;
      if (method === 'PUT') {
        const body = (await readJson(req)) as Partial<PushTokenRequest>;
        if (typeof body.token !== "string" || body.token.length < 20 || body.token.length > 4096) {
          throw new HttpError(400, 'invalid push token');
        }
        token = body.token;
      }
      await db.setPushToken(me, token);
      return send(204);
    }
    if (method === 'POST' && path === '/v1/attachments') {
      if (!uploadLimit.allow(me)) throw new HttpError(429, 'too many uploads');
      const b64 = (await readBody(req, MAX_ATTACHMENT_B64)).trim();
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new HttpError(400, 'invalid encoding');
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length < 40) throw new HttpError(400, 'too small');
      const id = randomBytes(16).toString('hex');
      await fs.writeFile(attachmentFile(id), bytes);
      return send(200, { id });
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/attachments\/([0-9a-f]{32})$/))) {
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(attachmentFile(m[1]!));
      } catch {
        throw new HttpError(404, 'attachment not found or expired');
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(bytes.toString('base64'));
    }
    if (method === 'GET' && path === '/v1/me') {
      const user = (await db.getUser(me))!;
      const me_: MeResponse = {
        username: me,
        isAdmin: config.adminUsers.includes(me),
        admins: config.adminUsers,
        policy: await getPolicy(),
        canShare: canShare(user),
        avatar: user.avatar_ver,
        phone: user.phone,
        email: user.email,
        name: user.display_name,
      };
      return send(200, me_);
    }
    // Profiles are made by the admin and locked: only admins may change their own details (employees ask the
    // admin). On a server without admins people manage their own.
    const profileLocked = config.adminUsers.length > 0 && !config.adminUsers.includes(me);
    if (method === 'PUT' && path === '/v1/me/contact') {
      if (profileLocked) throw new HttpError(403, 'Only your admin can change your profile');
      const body = (await readJson(req)) as { phone?: unknown; email?: unknown };
      const { phone, email } = checkContactInfo(body.phone, body.email);
      await db.setContactInfo(me, phone, email);
      return send(204);
    }
    // Online / last seen for a few usernames (the chat list); unknown names are left out.
    // ---- profile photos: everyone signed in may see them (they are not end-to-end encrypted) ----
    if (path === '/v1/avatar' && method === 'PUT') {
      if (profileLocked) throw new HttpError(403, 'Only your admin can change your profile photo');
      if (!uploadLimit.allow(me)) throw new HttpError(429, 'too many uploads');
      const photo = checkPhoto(await readJson(req, Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 1024));
      const ver = Date.now();
      await db.setAvatar(me, { ...photo, ver });
      return send(200, { ver });
    }
    if (path === '/v1/avatar' && method === 'DELETE') {
      if (profileLocked) throw new HttpError(403, 'Only your admin can change your profile photo');
      await db.setAvatar(me, null);
      return send(204);
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/avatars\/([a-z0-9_.]{3,32})$/))) {
      const a = await db.getAvatar(m[1]!);
      if (!a) throw new HttpError(404, 'no photo');
      const out: AvatarResponse = a;
      return send(200, out);
    }
    // ---- catalogs (like WhatsApp Business): everyone has their own and changes only that; colleagues may
    // browse a person's catalog from their profile ----
    if (method === 'GET' && path === '/v1/catalog') {
      const owner = url.searchParams.get('owner') ?? me;
      if (!USERNAME_RE.test(owner)) throw new HttpError(400, 'invalid owner');
      return send(200, { products: (await db.listProducts(owner)).map(toProductInfo) });
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/catalog\/([0-9a-f]{16})\/photo$/))) {
      const photo = await db.getProductPhoto(m[1]!);
      if (!photo) throw new HttpError(404, 'no photo');
      return send(200, photo);
    }
    if (method === 'POST' && path === '/v1/catalog') {
      if (!uploadLimit.allow(me)) throw new HttpError(429, 'too many uploads');
      if ((await db.listProducts(me)).length >= MAX_PRODUCTS) throw new HttpError(400, `A catalog can have at most ${MAX_PRODUCTS} products`);
      const input = parseProductInput(await readJson(req, Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 8192), true);
      const id = randomBytes(8).toString('hex');
      await db.putProduct({ id, owner: me, ...input.fields, updated_at: Date.now() }, input.photo ?? undefined);
      return send(200, toProductInfo((await db.getProduct(id))!));
    }
    if ((m = path.match(/^\/v1\/catalog\/([0-9a-f]{16})$/)) && (method === 'PUT' || method === 'DELETE')) {
      const product = await db.getProduct(m[1]!);
      if (!product) throw new HttpError(404, 'product not found');
      // Only the owner changes their catalog; an admin may also remove a product (moderation).
      const isAdmin = config.adminUsers.includes(me);
      if (product.owner !== me && !(method === 'DELETE' && isAdmin)) throw new HttpError(403, 'Not your product');
      if (method === 'PUT') {
        if (!uploadLimit.allow(me)) throw new HttpError(429, 'too many uploads');
        const input = parseProductInput(await readJson(req, Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 8192), false, product);
        await db.putProduct({ id: product.id, owner: product.owner, ...input.fields, updated_at: Date.now() }, input.photo);
        return send(200, toProductInfo((await db.getProduct(product.id))!));
      }
      await db.deleteProduct(product.id);
      if (product.owner !== me) await audit(me, 'catalog.delete', product.name, `from ${product.owner}'s catalog`);
      return send(204);
    }
    if (method === 'GET' && path === '/v1/presence') {
      const names = [...new Set((url.searchParams.get('u') ?? '').split(',').filter((u) => USERNAME_RE.test(u)))];
      if (names.length > 200) throw new HttpError(400, 'too many users');
      const out: Record<string, Presence> = {};
      for (const u of await Promise.all(names.map((n) => db.getUser(n)))) {
        if (u) {
          out[u.username] = { online: isOnline(u), lastSeen: u.last_seen === null ? null : Number(u.last_seen), avatar: u.avatar_ver };
        }
      }
      return send(200, out);
    }
    if (method === 'GET' && path === '/v1/groups') {
      // Members can only exchange messages with people who have logged in and are not suspended.
      const reachable = new Set((await db.listUsers()).filter((u) => isActive(u) && !u.banned).map((u) => u.username));
      const groups = (await db.groupsOf(me)).map((g) => ({ ...toGroupInfo(g), members: g.members.filter((u) => reachable.has(u)) }));
      return send(200, { groups });
    }
    if (method === 'POST' && path === '/v1/password') {
      const body = (await readJson(req)) as { oldPassword?: unknown; newPassword?: unknown };
      const user = (await await db.getUser(me))!;
      if (typeof body.oldPassword !== 'string' || !verifyPassword(body.oldPassword, user.pass_hash)) {
        authFailLimit.allow(clientIp(req));
        throw new HttpError(401, 'Current password is wrong');
      }
      checkNewPassword(body.newPassword, body.oldPassword);
      await db.setPassword(me, hashPassword(body.newPassword as string), false);
      return send(204);
    }

    // ---- admin: employee accounts ----
    if (path.startsWith('/v1/admin/')) {
      if (!config.adminUsers.includes(me)) throw new HttpError(403, 'admin only');

      if (method === 'GET' && path === '/v1/admin/users') {
        const users: AdminUser[] = (await db.listUsers()).map((u) => ({
          username: u.username,
          active: isActive(u),
          admin: config.adminUsers.includes(u.username),
          mustChangePassword: !!u.must_change,
          banned: !!u.banned,
          online: isOnline(u),
          lastSeen: u.last_seen === null ? null : Number(u.last_seen),
          createdAt: Number(u.created_at),
          departments: u.departments,
          canShare: canShare(u),
          avatar: u.avatar_ver,
          phone: u.phone,
          email: u.email,
          name: u.display_name,
          inviteExpires: u.invite_hash && Number(u.invite_expires) > Date.now() ? Number(u.invite_expires) : null,
        }));
        return send(200, { users });
      }
      if (method === 'POST' && path === '/v1/admin/users') {
        const body = (await readJson(req, Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 8192)) as {
          username?: unknown;
          password?: unknown;
          departments?: unknown;
          canShare?: unknown;
          phone?: unknown;
          email?: unknown;
          name?: unknown;
          photo?: unknown;
        };
        if (typeof body.username !== 'string' || !USERNAME_RE.test(body.username)) {
          throw new HttpError(400, 'ID must be 3-32 characters: a-z, 0-9, _ or .');
        }
        // Normally there is no password: the person chooses one when they scan the QR invite.
        if (body.password !== undefined) checkNewPassword(body.password);
        const departments = await checkDepartments(body.departments);
        const { phone, email } = checkContactInfo(body.phone, body.email);
        const name = checkName(body.name);
        const photo = body.photo === undefined ? null : checkPhoto(body.photo);
        if (body.canShare !== undefined && typeof body.canShare !== 'boolean') {
          throw new HttpError(400, 'canShare must be true or false');
        }
        const canShare = body.canShare === true;
        if (await db.getUser(body.username)) throw new HttpError(409, 'That ID already exists');
        const password = typeof body.password === 'string' ? body.password : randomBytes(24).toString('base64url');
        await db.createPendingUser(body.username, hashPassword(password), { departments, canShare, phone, email, name });
        if (photo) await db.setAvatar(body.username, { ...photo, ver: Date.now() });
        const invite = await newInvite(body.username);
        const detail = [name, departments.length && `departments: ${departments.join(', ')}`, phone && `mobile ${phone}`, email && `email ${email}`];
        await audit(me, 'user.create', body.username, detail.filter(Boolean).join(', '));
        return send(200, { ok: true, invite });
      }
      if ((m = path.match(/^\/v1\/admin\/users\/([a-z0-9_.]{3,32})(\/password|\/ban|\/departments|\/share|\/contact|\/invite|\/profile|\/avatar)?$/))) {
        const target = await db.getUser(m[1]!);
        if (!target) throw new HttpError(404, 'user not found');
        // A new QR invite (also to move someone to a new phone: joining replaces their old device).
        if (method === 'POST' && m[2] === '/invite') {
          const invite = await newInvite(target.username);
          await audit(me, 'user.invite', target.username, 'new QR invite');
          return send(200, invite);
        }
        if (method === 'PUT' && m[2] === '/profile') {
          const body = (await readJson(req)) as { name?: unknown; phone?: unknown; email?: unknown };
          const name = body.name === undefined ? target.display_name : checkName(body.name);
          const { phone, email } = checkContactInfo(body.phone ?? target.phone, body.email ?? target.email);
          await db.setDisplayName(target.username, name);
          await db.setContactInfo(target.username, phone, email);
          await audit(me, 'user.profile', target.username, [name, phone, email].filter(Boolean).join(', ') || 'cleared');
          return send(204);
        }
        if (m[2] === '/avatar' && (method === 'PUT' || method === 'DELETE')) {
          if (method === 'DELETE') {
            await db.setAvatar(target.username, null);
            await audit(me, 'user.profile', target.username, 'removed photo');
            return send(204);
          }
          if (!uploadLimit.allow(me)) throw new HttpError(429, 'too many uploads');
          const photo = checkPhoto(await readJson(req, Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 1024));
          const ver = Date.now();
          await db.setAvatar(target.username, { ...photo, ver });
          await audit(me, 'user.profile', target.username, 'changed photo');
          return send(200, { ver });
        }
        if (method === 'PUT' && m[2] === '/contact') {
          const body = (await readJson(req)) as { phone?: unknown; email?: unknown };
          const { phone, email } = checkContactInfo(body.phone, body.email);
          await db.setContactInfo(target.username, phone, email);
          await audit(me, 'user.contact', target.username, [phone && `mobile ${phone}`, email && `email ${email}`].filter(Boolean).join(', ') || 'cleared');
          return send(204);
        }
        if (method === 'PUT' && m[2] === '/share') {
          const body = (await readJson(req)) as { canShare?: unknown };
          if (typeof body.canShare !== 'boolean') throw new HttpError(400, 'canShare must be true or false');
          await db.setCanShare(target.username, body.canShare);
          await audit(me, body.canShare ? 'user.share_on' : 'user.share_off', target.username);
          await notify([target.username], 'policy'); // their app re-reads /v1/me and shows or hides Save/Share
          return send(204);
        }
        if (method === 'PUT' && m[2] === '/departments') {
          const body = (await readJson(req)) as { departments?: unknown };
          const departments = await checkDepartments(body.departments);
          await db.setDepartments(target.username, departments);
          await audit(me, 'user.department', target.username, departments.join(', ') || 'none');
          return send(204);
        }
        if (method === 'POST' && m[2] === '/password') {
          const body = (await readJson(req)) as { password?: unknown };
          checkNewPassword(body.password);
          await db.setPassword(target.username, hashPassword(body.password as string), true);
          await audit(me, 'user.reset_password', target.username);
          return send(204);
        }
        if (method === 'POST' && m[2] === '/ban') {
          const body = (await readJson(req)) as { banned?: unknown };
          if (typeof body.banned !== 'boolean') throw new HttpError(400, 'banned must be true or false');
          if (target.username === me) throw new HttpError(400, "You can't ban yourself");
          if (config.adminUsers.includes(target.username)) throw new HttpError(400, "Admins can't be banned");
          await db.setBanned(target.username, body.banned);
          if (body.banned) {
            // Blocking signs them out for good: their device is cut off (its app deletes its keys), their password
            // stops working and any QR invite is cancelled. Unblocking alone doesn't let them back in; the admin
            // gives them a new QR code.
            await db.clearDevice(target.username);
            await db.setPassword(target.username, hashPassword(randomBytes(24).toString('base64url')), true);
            await db.setInvite(target.username, null);
            await kick(target.username, 4005, 'account suspended');
          }
          await audit(me, body.banned ? 'user.ban' : 'user.unban', target.username);
          await notifyGroupsOf(target.username);
          return send(204);
        }
        if (method === 'DELETE' && !m[2]) {
          if (target.username === me) throw new HttpError(400, "You can't remove yourself");
          const groups = await db.groupsOf(target.username);
          await db.deleteUser(target.username);
          await kick(target.username, 4001, 'account removed by admin');
          await audit(me, 'user.delete', target.username);
          if (groups.length) await notify([...new Set(groups.flatMap((g) => g.members))], 'groups');
          return send(204);
        }
      }

      // ---- departments: the list admins pick from when they add or move a user ----
      if (path === '/v1/admin/departments') {
        if (method === 'GET') return send(200, { departments: await getDepartments() });
        if (method === 'POST') {
          const name = checkDepartmentName(((await readJson(req)) as { name?: unknown }).name);
          const list = await getDepartments();
          if (list.some((d) => sameName(d, name))) throw new HttpError(409, `"${name}" already exists`);
          if (list.length >= MAX_DEPARTMENTS) throw new HttpError(400, `Up to ${MAX_DEPARTMENTS} departments`);
          await saveDepartments([...list, name]);
          await audit(me, 'department.create', name);
          return send(200, { departments: await getDepartments() });
        }
      }
      if ((m = path.match(/^\/v1\/admin\/departments\/([^/]+)$/))) {
        let current: string;
        try {
          current = decodeURIComponent(m[1]!);
        } catch {
          throw new HttpError(400, 'bad department name');
        }
        const list = await getDepartments();
        const found = list.find((d) => sameName(d, current));
        if (!found) throw new HttpError(404, 'department not found');
        if (method === 'PUT') {
          const name = checkDepartmentName(((await readJson(req)) as { name?: unknown }).name);
          if (list.some((d) => d !== found && sameName(d, name))) throw new HttpError(409, `"${name}" already exists`);
          await replaceDepartment(found, name);
          await saveDepartments(list.map((d) => (d === found ? name : d)));
          await audit(me, 'department.rename', name, `was: ${found}`);
          return send(200, { departments: await getDepartments() });
        }
        if (method === 'DELETE') {
          await replaceDepartment(found, null); // its people are kept, just not in this department
          await saveDepartments(list.filter((d) => d !== found));
          await audit(me, 'department.delete', found);
          return send(200, { departments: await getDepartments() });
        }
      }

      if (method === 'GET' && path === '/v1/admin/stats') {
        const users = await db.listUsers();
        const stats: AdminStats = {
          users: users.length,
          active: users.filter(isActive).length,
          pending: users.filter((u) => !isActive(u)).length,
          banned: users.filter((u) => u.banned).length,
          online: users.filter(isOnline).length,
          admins: users.filter((u) => config.adminUsers.includes(u.username)).length,
          groups: (await db.listGroups()).length,
        };
        return send(200, stats);
      }
      if (method === 'GET' && path === '/v1/admin/audit') {
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
        const entries: AuditEntry[] = await db.listAudit(limit);
        return send(200, { entries });
      }
      if (path === '/v1/admin/settings') {
        if (method === 'GET') return send(200, await getPolicy());
        if (method === 'PUT') {
          const body = (await readJson(req)) as Partial<Policy>;
          // Send just the switches you change; the others keep their value.
          const keys = ['allowEditDelete', 'allowClearHistory'] as const;
          const given = keys.filter((k) => body[k] !== undefined);
          if (!given.length) throw new HttpError(400, 'nothing to change');
          for (const k of given) if (typeof body[k] !== 'boolean') throw new HttpError(400, `${k} must be true or false`);
          const policy: Policy = { ...(await getPolicy()) };
          for (const k of given) policy[k] = body[k] as boolean;
          await db.setMeta('policy', JSON.stringify(policy));
          const label = { allowEditDelete: 'edit/delete messages', allowClearHistory: 'clear chat history' };
          const detail = given.map((k) => `${label[k]}: ${policy[k] ? 'on' : 'off'}`).join(', ');
          await audit(me, 'settings.update', 'policy', detail);
          await notify(null, 'policy');
          return send(200, policy);
        }
      }

      // ---- groups: only admins create them and decide who is in them ----
      if (method === 'GET' && path === '/v1/admin/groups') {
        return send(200, { groups: (await db.listGroups()).map(toGroupInfo) });
      }
      if (method === 'POST' && path === '/v1/admin/groups') {
        const body = (await readJson(req)) as { name?: unknown; members?: unknown; senders?: unknown };
        const name = checkGroupName(body.name);
        const members = await existingMembers(checkMemberList(body.members ?? []));
        const senders = checkSenders(body.senders, members);
        const id = randomBytes(8).toString('hex');
        await db.createGroup({ id, name, createdBy: me, members, senders });
        const who = senders ? `; only these can send: ${senders.join(', ') || 'admins'}` : '';
        await audit(me, 'group.create', name, `members: ${members.join(', ') || 'none'}${who}`);
        await notify(members, 'groups');
        return send(200, toGroupInfo((await db.getGroup(id))!));
      }
      if ((m = path.match(/^\/v1\/admin\/groups\/([0-9a-f]+)$/)) && GROUP_ID_RE.test(m[1]!)) {
        const group = await db.getGroup(m[1]!);
        if (!group) throw new HttpError(404, 'group not found');
        if (method === 'PUT') {
          const body = (await readJson(req)) as { name?: unknown; members?: unknown; senders?: unknown };
          const name = body.name === undefined ? undefined : checkGroupName(body.name);
          const members = body.members === undefined ? undefined : await existingMembers(checkMemberList(body.members));
          const finalMembers = members ?? group.members;
          // Not sent: keep the current rule, minus anyone who left the group.
          const senders =
            body.senders !== undefined
              ? checkSenders(body.senders, finalMembers)
              : group.senders && group.senders.filter((u) => finalMembers.includes(u));
          await db.updateGroup(group.id, { name, members, senders });
          const details: string[] = [];
          if (name !== undefined && name !== group.name) details.push(`renamed from "${group.name}"`);
          if (members) {
            const added = members.filter((u) => !group.members.includes(u));
            const removed = group.members.filter((u) => !members.includes(u));
            if (added.length) details.push(`added: ${added.join(', ')}`);
            if (removed.length) details.push(`removed: ${removed.join(', ')}`);
          }
          if (JSON.stringify(senders) !== JSON.stringify(group.senders)) {
            details.push(senders ? `only these can send: ${senders.join(', ') || 'admins'}` : 'everyone can send');
          }
          await audit(me, 'group.update', name ?? group.name, details.join('; '));
          await notify([...new Set([...group.members, ...(members ?? [])])], 'groups');
          return send(200, toGroupInfo((await db.getGroup(group.id))!));
        }
        if (method === 'DELETE') {
          await db.deleteGroup(group.id);
          await audit(me, 'group.delete', group.name);
          await notify(group.members, 'groups');
          return send(204);
        }
      }
    }
    if (method === 'DELETE' && path === '/v1/account') {
      // On a company server (one with admins) accounts belong to the company: only an admin removes them,
      // from the admin panel. Self-deletion is only for open servers without admins.
      if (config.adminUsers.length) throw new HttpError(403, 'Only an admin can delete accounts. Ask your admin.');
      const groups = await db.groupsOf(me);
      await db.deleteUser(me);
      await kick(me, 4001, 'account deleted');
      if (groups.length) await notify([...new Set(groups.flatMap((g) => g.members))], 'groups');
      return send(204);
    }
    throw new HttpError(404, 'not found');
  }

  const server = http.createServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    // CORS for the desktop app (its window runs at a different origin). Auth is a header, never a cookie,
    // so allowing any origin does not let other websites act as the user.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, PUT, DELETE',
        'access-control-allow-headers': 'content-type, authorization, x-delivery-key, x-push',
        'access-control-max-age': '600',
      });
      return res.end();
    }
    route(req, res).catch((e) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(status === 500 ? 'internal error' : e.message);
    });
  });

  // ---------------------------------------------------------------- websocket relay

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_ENVELOPE + 4096 });

  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://x').pathname !== '/v1/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws, clientIp(req)));
  });

  const frame = (ws: WebSocket, f: ServerFrame) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(f));

  /** Envelope ids already sent on each socket, so the same envelope is never delivered twice. */
  const delivered = new WeakMap<WebSocket, Set<number>>();
  function deliver(ws: WebSocket, row: { id: number; sender: string; body: string; ts: number }) {
    let seen = delivered.get(ws);
    if (!seen) delivered.set(ws, (seen = new Set()));
    if (seen.has(row.id)) return;
    seen.add(row.id);
    frame(ws, { type: 'envelope', id: row.id, from: row.sender, body: row.body, ts: row.ts });
  }

  /** Close a user's socket and forget cached credentials, on this and every other server instance. */
  async function kick(user: string, code: number, reason: string) {
    authCache.delete(user);
    online.get(user)?.close(code, reason);
    await bus.publish({ type: 'kick', user, code, reason }).catch((e) => console.error('bus publish failed', e));
  }

  const remoteDeliveries = new Map<string, Promise<void>>();
  bus.onEvent((e: BusEvent) => {
    if (e.type === 'kick') {
      authCache.delete(e.user);
      online.get(e.user)?.close(e.code, e.reason);
    } else if (e.type === 'connected') {
      online.get(e.user)?.close(4004, 'connected elsewhere');
    } else if (e.type === 'refresh') {
      for (const [u, ws] of online) if (!e.users || e.users.includes(u)) frame(ws, { type: 'refresh', what: e.what });
    } else if (e.type === 'envelope') {
      if (!online.has(e.to)) return;
      // One queue per recipient: notifications arrive in order, and so must the envelopes.
      const prev = remoteDeliveries.get(e.to) ?? Promise.resolve();
      const next = prev
        .then(async () => {
          const ws = online.get(e.to);
          const row = ws && (await db.envelope(e.id, e.to));
          if (ws && row) deliver(ws, row);
        })
        .catch((err) => console.error('envelope fetch failed', err));
      remoteDeliveries.set(e.to, next);
      void next.then(() => remoteDeliveries.get(e.to) === next && remoteDeliveries.delete(e.to));
    }
  });

  // ---- wake-up pushes ----
  // Only when a message is still waiting after a short delay (the recipient is really offline), at
  // most one "New message" push per person every 20 s. Calls always push. Never any content.
  const pushTimers = new Set<NodeJS.Timeout>();
  const lastMessagePush = new Map<string, number>();
  function schedulePush(to: string, envelopeId: number, kind: PushKind) {
    if (!push) return;
    const t = setTimeout(() => {
      pushTimers.delete(t);
      void (async () => {
        if (online.has(to) || !(await db.envelope(envelopeId, to))) return; // delivered in the meantime
        if (kind === 'message') {
          const last = lastMessagePush.get(to) ?? 0;
          if (Date.now() - last < 20_000) return;
          lastMessagePush.set(to, Date.now());
        }
        const user = await db.getUser(to);
        if (!user?.push_token) return;
        if ((await push.send(user.push_token, kind)) === 'invalid') await db.setPushToken(to, null);
      })().catch((e) => console.error('push failed', e));
    }, config.pushDelayMs ?? (kind === 'call' ? 1500 : 3000));
    pushTimers.add(t);
  }

  /** Hand a freshly queued envelope to the recipient's socket here, or to the instance that has it. */
  async function dispatch(to: string, row: { id: number; sender: string; body: string; ts: number }) {
    const socket = online.get(to);
    if (socket) deliver(socket, row);
    else await bus.publish({ type: 'envelope', to, id: row.id });
  }

  async function deliverPending(username: string, ws: WebSocket) {
    for (const row of await db.pending(username)) deliver(ws, row);
  }

  function onSocket(ws: WebSocket, ip: string) {
    let me: string | null = null;
    let alive = true;
    const authTimer = setTimeout(() => !me && ws.close(4000, 'auth timeout'), AUTH_TIMEOUT_MS);
    ws.on('pong', () => (alive = true));
    const markOnline = () => me && setPresence(me, Date.now());
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
      if (me && online.get(me) === ws) markOnline();
    }, 30_000);

    // Frames are handled strictly one after another, so messages keep their order even though
    // every database call is asynchronous.
    let chain: Promise<unknown> = Promise.resolve();
    ws.on('message', (raw) => {
      chain = chain
        .then(() => onFrame(raw.toString()))
        .catch((e) => {
          console.error('frame failed', e);
          ws.close(1011, 'server error');
        });
    });

    async function onFrame(raw: string): Promise<unknown> {
      let f: ClientFrame;
      try {
        f = JSON.parse(raw);
      } catch {
        return ws.close(4002, 'bad frame');
      }
      if (ws.readyState !== ws.OPEN) return;
      if (!me) {
        if (f.type !== 'auth') return ws.close(4000, 'auth required');
        try {
          me = await authenticate(f.username, f.password, ip);
        } catch (e) {
          // 'rate' is temporary; 'banned' lasts until an admin lifts it (keys are kept);
          // 'auth' means this device's secret is no longer valid (logged in elsewhere / removed) - the app then
          // deletes its keys, so it must ONLY be sent for a real 401. Anything else (database busy, server
          // shutting down) is 'unavailable': the app keeps everything and reconnects.
          const status = e instanceof HttpError ? e.status : 0;
          if (!status) console.error('auth check failed', e);
          const [code, message] =
            status === 401
              ? ['auth', 'Authentication failed']
              : status === 403
                ? ['banned', BANNED_MESSAGE]
                : status === 429
                  ? ['rate', 'Too many attempts, retrying later']
                  : ['unavailable', 'Server busy, reconnecting'];
          frame(ws, { type: 'error', code, message });
          return ws.close(4003, 'auth failed');
        }
        clearTimeout(authTimer);
        const preKeyCount = await db.countOneTimePreKeys(me);
        frame(ws, {
          type: 'ready',
          preKeyCount,
          isAdmin: config.adminUsers.includes(me),
          admins: config.adminUsers,
          policy: await getPolicy(),
          canShare: canShare((await db.getUser(me))!),
          avatar: (await db.getUser(me))!.avatar_ver,
        });
        // Queued envelopes first, THEN register as online (new messages are delivered directly from then
        // on), then check the queue once more for anything that arrived in between. deliver() skips repeats.
        await deliverPending(me, ws);
        online.get(me)?.close(4004, 'connected elsewhere');
        online.set(me, ws);
        markOnline();
        await bus.publish({ type: 'connected', user: me });
        await deliverPending(me, ws);
        return;
      }
      switch (f.type) {
        case 'ping':
          return frame(ws, { type: 'pong' });
        case 'ack':
          if (!Number.isInteger(f.id)) return;
          delivered.get(ws)?.delete(f.id);
          await db.ack(f.id, me);
          return;
        case 'send': {
          const ref = typeof f.ref === 'string' ? f.ref.slice(0, 64) : '';
          const fail = (code: string, message: string) => frame(ws, { type: 'error', ref, code, message });
          if (!sendLimit.allow(me)) return fail('rate', 'Sending too fast');
          const target = typeof f.to === 'string' && USERNAME_RE.test(f.to) ? await db.getUser(f.to) : undefined;
          if (!target) return fail('unknown_user', 'User not found');
          if (!isActive(target)) return fail('not_active', `${target.username} has not logged in yet`);
          if (target.banned) return fail('banned', `${target.username} is suspended`);
          if (typeof f.body !== 'string' || f.body.length > MAX_ENVELOPE) return fail('too_large', 'Message too large');
          if ((await db.queueSize(f.to)) >= MAX_QUEUE) return fail('queue_full', "Recipient's inbox is full");
          const ts = Date.now();
          const id = await db.enqueue(f.to, me, f.body, ts);
          frame(ws, { type: 'sent', ref, ts });
          await dispatch(f.to, { id, sender: me, body: f.body, ts });
          if (f.push === 'message' || f.push === 'call') schedulePush(f.to, id, f.push);
          return;
        }
      }
    }

    ws.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      if (me && online.get(me) === ws) {
        online.delete(me);
        setPresence(me, null);
      }
    });
  }

  async function purgeAttachments() {
    const cutoff = Date.now() - ATTACHMENT_TTL_MS;
    for (const name of await fs.readdir(attachmentsDir).catch(() => [] as string[])) {
      const file = join(attachmentsDir, name);
      const st = await fs.stat(file).catch(() => null);
      if (st && st.mtimeMs < cutoff) await fs.rm(file, { force: true });
    }
  }
  const purge = setInterval(() => {
    void db.purgeOlderThan(Date.now() - QUEUE_TTL_MS).catch((e) => console.error('purge failed', e));
    void purgeAttachments();
  }, 3600_000);
  server.on('close', () => {
    closing = true;
    clearInterval(purge);
    pushTimers.forEach(clearTimeout);
    wss.close();
    void db.close();
  });

  return server;
}
