import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { mkdirSync, promises as fs } from 'node:fs';
import http from 'node:http';
import { dirname, extname, join, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
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
  ID_RE,
  ID_RULES,
  normalizeId,
  BIRTHDAY_RE,
  COMPANY_CODE_RE,
  MAX_COMPANY_NAME,
  companyOf,
  makeUsername,
  shortId,
  ALL_RIGHTS,
  FEATURE_KEYS,
  MAX_BACKUP_CHARS,
  MAX_BACKUP_OP,
  MAX_BACKUP_OPS,
  MAX_HELP_CONTACTS,
  MAX_HELP_FIELD,
  PAGE_SIZE,
  resolveRight,
  type Feature,
  type HelpContact,
  type HistoryBackup,
  type MyRights,
  type Page,
  type RightChange,
  type RightRule,
  type Rights,
  MAX_COMMUNITIES,
  type ChannelInfo,
  type Community,
  MAX_ABOUT,
  MAX_REPORT_MESSAGES,
  REPORT_REASONS,
  DELETE_REQUEST,
  type Report,
  type PrivacyRequest,
  type CompanyInfo,
  type NewCompanyRequest,
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
  generatePassword,
  inviteCode,
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
import { MOVED, isActive, isOnlineRow, openSqlite, type Db, type GroupRow, type ProductPhoto, type ProductRow, type UserRow } from './db';
import { CALL_UI_PREFIX, type PushSender } from './push';
import { APNS_PREFIX, parseAppleToken } from './apns';
import { WEB_PUSH_PREFIX, WebPushSender, newVapidKeys, parseSubscription, type VapidKeys } from './webpush';

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
  /** Contact address shown on /privacy, /terms and /support. */
  supportEmail?: string;
  /** How long a message may wait unacknowledged before a wake-up push is sent (ms). */
  pushDelayMs?: number;
  /** Official address (e.g. https://chat.example.com). After a domain change, clients still using an old address move here. */
  publicUrl?: string;
  /** The built web app (apps/desktop/web/dist), served at /app/. */
  appDir?: string;
}

const MAX_BODY = 64 * 1024;
const MAX_ENVELOPE = 256 * 1024;
/** Encrypted attachments are sent as base64 text (works the same on every client platform). */
const MAX_ATTACHMENT_B64 = Math.ceil(((MAX_ATTACHMENT_BYTES + 64) * 4) / 3) + 4;
const ATTACHMENT_TTL_MS = 14 * 24 * 3600 * 1000;
const MAX_QUEUE = 5000;
const QUEUE_TTL_MS = 30 * 24 * 3600 * 1000;
const AUTH_TIMEOUT_MS = 5000;
/** The super admin's web page (companies, approvals): static files in ./web, served by this server. */
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), 'web');
const WEB_FILES: Record<string, [file: string, type: string]> = {
  '/super': ['super.html', 'text/html; charset=utf-8'],
  '/super.js': ['super.js', 'text/javascript; charset=utf-8'],
  '/super.css': ['super.css', 'text/css; charset=utf-8'],
  // Public pages for the app stores and the sign-in screen.
  '/privacy': ['privacy.html', 'text/html; charset=utf-8'],
  '/terms': ['terms.html', 'text/html; charset=utf-8'],
  '/support': ['support.html', 'text/html; charset=utf-8'],
  '/legal.css': ['legal.css', 'text/css; charset=utf-8'],
};
const WEB_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";
const WEB_SESSION_MS = 8 * 3600_000;
const SEALED_PATH = /^\/v1\/sealed\/([^/]+)$/;
/** An account address from a URL path segment (IDs may have spaces and symbols, so they come %-encoded). */
function userSeg(raw: string): string {
  let u: string;
  try {
    u = decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'invalid ID');
  }
  if (!USERNAME_RE.test(u)) throw new HttpError(404, 'user not found');
  return u;
}

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
const MOVED_MESSAGE = 'You were moved to another company. Scan the QR code from your new admin.';
const accountClosed = (u: UserRow) => (u.banned === MOVED ? MOVED_MESSAGE : BANNED_MESSAGE);
const PENDING_MESSAGE = 'Your company is waiting for approval by the server owner. You can use CellMate as soon as it is approved.';
const SUSPENDED_MESSAGE = 'Your company has been suspended by the server owner.';

function checkCompanyCode(v: unknown): string {
  if (typeof v !== 'string' || !COMPANY_CODE_RE.test(v)) throw new HttpError(400, 'Company code: 2-16 characters, a-z and 0-9 only');
  return v;
}

function checkCompanyName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_COMPANY_NAME) throw new HttpError(400, `Company name: 1-${MAX_COMPANY_NAME} characters`);
  return name;
}

function parseList(v: string | undefined): string[] {
  try {
    const list = JSON.parse(v ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const toGroupInfo = (g: GroupRow): GroupInfo => ({
  id: g.id,
  name: g.name,
  members: g.members,
  senders: g.senders,
  admins: g.admins.filter((u) => g.members.includes(u)),
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

// Async scrypt runs on the libuv thread pool, so a burst of logins can't stall every other connection.
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: ScryptOptions) => Promise<Buffer>;
const SCRYPT_OPTS: ScryptOptions = { N: 16384, r: 8, p: 1 };

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, 32, SCRYPT_OPTS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  // timingSafeEqual throws on different lengths: a damaged stored hash must fail, not crash the request.
  if (expected.length !== 32) return false;
  const actual = await scryptAsync(pw, Buffer.from(salt, 'base64'), 32, SCRYPT_OPTS);
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

export function createMeetMeServer(
  config: ServerConfig,
  deps: { db?: Db; bus?: Bus; push?: PushSender | null; apns?: PushSender | null } = {},
) {
  const db: Db = deps.db ?? openSqlite(config.dbPath);
  const bus: Bus = deps.bus ?? new LocalBus();
  const push = deps.push ?? null;
  const apns = deps.apns ?? null;

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
  // Web Push for the web app (iPhone home screen): the server's own VAPID key, made once and kept in the database.
  const webPush = db
    .getOrCreateMeta('vapid_keys', () => JSON.stringify(newVapidKeys()))
    .then((v) => {
      const keys = JSON.parse(v) as VapidKeys;
      return { keys, sender: new WebPushSender(keys, config.publicUrl || 'mailto:admin@localhost') };
    });
  webPush.catch((e) => console.error('could not load the web push key', e));
  const sealedLimit = new RateLimiter(600, 60_000);
  /** Super admin web sign-ins: SHA-256 of the token -> who and until when (memory only; a restart signs out). */
  const webSessions = new Map<string, { user: string; until: number }>();
  const tokenHash = (t: string) => createHash('sha256').update(t).digest('base64');
  function webSessionUser(token: string): string {
    const s = webSessions.get(tokenHash(token));
    if (!s || s.until < Date.now()) throw new HttpError(401, 'Signed out. Sign in again.');
    return s.user;
  }
  const online = new Map<string, WebSocket>();
  const authCache = new Map<string, { digest: string; until: number }>();
  const registerLimit = new RateLimiter(10, 3600_000);
  const authFailLimit = new RateLimiter(20, 60_000);
  const requestLimit = new RateLimiter(600, 60_000);
  const sendLimit = new RateLimiter(1200, 60_000);

  const clientIp = (req: http.IncomingMessage) =>
    // The LAST entry is the one our own proxy (Caddy) added; earlier ones come from the client and can be faked.
    (config.trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim()) ||
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
    if (!user || !user.device_hash || !(await verifyPassword(password, user.device_hash))) {
      authFailLimit.allow(ip);
      throw new HttpError(401, 'unauthorized');
    }
    // Banning kicks the user, which also clears this cache, so a ban takes effect at once.
    if (user.banned) throw new HttpError(403, accountClosed(user));
    const closed = await companyClosed(username);
    if (closed) throw new HttpError(403, closed);
    authCache.set(username, { digest, until: Date.now() + 10 * 60_000 });
    return username;
  }

  let closing = false;
  /** Online / last seen bookkeeping; skipped while shutting down (the database is closing). */
  const setPresence = (u: string, onlineAt: number | null) => {
    if (!closing) void db.setPresence(u, onlineAt, Date.now()).catch((e) => console.error('presence failed', e));
  };

  const isOnline = (u: UserRow) => online.has(u.username) || isOnlineRow(u);

  // ---- companies ----
  // A company's people are "<id>-<code>". The company list, each company's admins, departments and policy live
  // in `meta`. Accounts without a company part (older / open servers) form the '' company, whose admins are
  // ADMIN_USERS. People only ever see, find and message people in their own company.
  /** status: missing = active; 'pending' = asked for, waits for the super admin's approval. */
  type Company = { code: string; name: string; createdAt: number; status?: 'pending' | 'active' | 'suspended' };
  async function listCompanies(): Promise<Company[]> {
    try {
      const list = JSON.parse((await db.getMeta('companies')) ?? '[]') as unknown;
      return Array.isArray(list) ? (list as Company[]) : [];
    } catch {
      return [];
    }
  }
  const saveCompanies = (list: Company[]) => db.setMeta('companies', JSON.stringify(list));
  const getCompany = async (code: string) => (await listCompanies()).find((c) => c.code === code);
  /** Per-company meta key; the '' company keeps the old server-wide keys. */
  const metaKey = (key: string, company: string) => (company ? `${key}:${company}` : key);
  async function adminsOf(company: string): Promise<string[]> {
    return company ? parseList(await db.getMeta(metaKey('admins', company))) : config.adminUsers;
  }
  const setAdmins = (company: string, list: string[]) =>
    db.setMeta(metaKey('admins', company), JSON.stringify(sortNames([...new Set(list)])));
  const isAdminUser = async (u: string) => (await adminsOf(companyOf(u))).includes(u);
  /**
   * The company's main admin (who set it up): other admins can't remove them or take their admin role away.
   * Companies from before this was stored: the admin whose account is oldest.
   */
  async function ownerOf(company: string): Promise<string | null> {
    if (!company) return null;
    const stored = await db.getMeta(metaKey('owner', company));
    const admins = await adminsOf(company);
    if (stored && admins.includes(stored)) return stored;
    const rows = (await Promise.all(admins.map((a) => db.getUser(a)))).filter((u): u is UserRow => !!u);
    rows.sort((a, b) => Number(a.created_at) - Number(b.created_at));
    return rows[0]?.username ?? null;
  }
  const superAdmins = async () => parseList(await db.getMeta('super_admins'));
  const sameCompany = (a: string, b: string) => companyOf(a) === companyOf(b);
  const companyUsers = (company: string) => db.companyUsers(company);
  /** Another account, but only if it is in my company: other companies don't exist for me. */
  const colleague = async (me: string, username: string) => (sameCompany(me, username) ? db.getUser(username) : undefined);
  /** Why the people of this account's company can't use the server now (null = they can). */
  async function companyClosed(username: string): Promise<string | null> {
    const code = companyOf(username);
    if (!code) return null;
    const c = await getCompany(code);
    if (!c) return SUSPENDED_MESSAGE;
    return c.status === 'pending' ? PENDING_MESSAGE : c.status === 'suspended' ? SUSPENDED_MESSAGE : null;
  }
  // The server owner (super admin) is an account of its own, in no company: ID + password, used on the /super web
  // page. Until it exists, a one-time setup code from the server log proves that it is really the owner setting up.
  async function setupCode(): Promise<string | null> {
    if ((await superAdmins()).length) return null;
    return db.getOrCreateMeta('setup_code', () => randomBytes(9).toString('base64url'));
  }
  void setupCode()
    .then((c) => c && console.log(`Owner setup: open <your server>/super and enter the setup code ${c}`))
    .catch((e) => console.error('setup code failed', e));

  async function companyInfo(company: string): Promise<{ code: string; name: string } | null> {
    if (!company) return null;
    const c = await getCompany(company);
    return { code: company, name: c?.name ?? company };
  }

  async function notifyGroupsOf(user: string) {
    const groups = await db.groupsOf(user);
    if (groups.length) await notify([...new Set(groups.flatMap((g) => g.members))], 'groups');
  }

  async function existingMembers(list: string[], company: string): Promise<string[]> {
    const known = new Set((await companyUsers(company)).map((u) => u.username));
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
  async function getDepartments(company: string): Promise<string[]> {
    const stored = parseList(await db.getMeta(metaKey('departments', company)));
    for (const u of await companyUsers(company)) {
      for (const d of u.departments) if (!stored.some((s) => sameName(s, d))) stored.push(d);
    }
    return sortNames(stored);
  }
  const saveDepartments = (company: string, list: string[]) =>
    db.setMeta(metaKey('departments', company), JSON.stringify(sortNames(list)));

  /** A user's departments: missing or [] = none; each must be on the department list. Returns them A-Z, once each. */
  async function checkDepartments(company: string, v: unknown): Promise<string[]> {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > MAX_DEPARTMENTS) throw new HttpError(400, 'departments must be a list of names');
    const list = await getDepartments(company);
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
  async function replaceDepartment(company: string, from: string, to: string | null) {
    for (const u of await companyUsers(company)) {
      if (!u.departments.includes(from)) continue;
      const next = u.departments.filter((d) => d !== from);
      if (to && !next.includes(to)) next.push(to);
      await db.setDepartments(u.username, sortNames(next));
    }
  }

  // A server without admins has nobody to switch protections on or off, so there users keep full control
  // of their own history; with an admin, history is protected until the admin allows clearing it.
  async function getPolicy(company: string): Promise<Policy> {
    const defaultPolicy: Policy = { ...DEFAULT_POLICY, allowClearHistory: (await adminsOf(company)).length === 0 };
    try {
      return { ...defaultPolicy, ...(JSON.parse((await db.getMeta(metaKey('policy', company))) ?? '{}') as Partial<Policy>) };
    } catch {
      return defaultPolicy;
    }
  }

  // ---- rights: rules per company (JSON in meta). The old company switches (policy) are the company rules of
  // editDelete / clearHistory, so older apps keep working. ----
  async function getRules(company: string): Promise<RightRule[]> {
    let rules: RightRule[] = [];
    try {
      const list = JSON.parse((await db.getMeta(metaKey('rights', company))) ?? '[]') as unknown;
      if (Array.isArray(list)) rules = (list as RightRule[]).filter((r) => FEATURE_KEYS.includes(r.feature));
    } catch {
      /* damaged: no rules */
    }
    const policy = await getPolicy(company);
    for (const [feature, allow] of [['editDelete', policy.allowEditDelete], ['clearHistory', policy.allowClearHistory]] as const) {
      if (!rules.some((r) => r.feature === feature && r.scope === 'company')) {
        rules.push({ feature, scope: 'company', target: '', member: '', allow, setBy: '', setAt: 0 });
      }
    }
    return rules;
  }
  async function saveRules(company: string, rules: RightRule[]) {
    await db.setMeta(metaKey('rights', company), JSON.stringify(rules));
    // Keep the old switches in step for apps that only know those.
    const policy = { ...(await getPolicy(company)) };
    for (const [feature, key] of [['editDelete', 'allowEditDelete'], ['clearHistory', 'allowClearHistory']] as const) {
      const rule = rules.find((r) => r.feature === feature && r.scope === 'company');
      if (rule) policy[key] = rule.allow;
    }
    await db.setMeta(metaKey('policy', company), JSON.stringify(policy));
  }

  /** What this person may do: everywhere, and where a group's chat differs. Company admins may do everything. */
  async function rightsOf(user: UserRow, rules?: RightRule[], groups?: GroupRow[]): Promise<MyRights> {
    if (await isAdminUser(user.username)) return { all: { ...ALL_RIGHTS }, groups: {} };
    const co = companyOf(user.username);
    rules ??= await getRules(co);
    const who = { username: user.username, departments: user.departments };
    const all = Object.fromEntries(FEATURE_KEYS.map((f) => [f, resolveRight(rules, f, who)])) as Rights;
    const out: MyRights = { all, groups: {} };
    for (const g of groups ?? (await db.groupsOf(user.username))) {
      const diff: Partial<Rights> = {};
      for (const f of FEATURE_KEYS) {
        const v = resolveRight(rules, f, who, g.id);
        if (v !== all[f]) diff[f] = v;
      }
      if (Object.keys(diff).length) out.groups[g.id] = diff;
    }
    return out;
  }

  /** Group admins: members the company admins (or other group admins) put in charge of the group. */
  const groupAdminsOf = (g: GroupRow) => g.admins.filter((u) => g.members.includes(u));
  async function mayManageGroup(me: string, g: GroupRow): Promise<boolean> {
    if (companyOf(g.created_by) !== companyOf(me)) return false;
    return (await isAdminUser(me)) || groupAdminsOf(g).includes(me);
  }

  /** Checks one rule change; group admins may only change rules of their own group. */
  async function checkRightChange(me: string, raw: unknown): Promise<RightChange> {
    const b = (raw ?? {}) as Partial<RightChange>;
    if (!FEATURE_KEYS.includes(b.feature as Feature)) throw new HttpError(400, 'Unknown function');
    if (b.allow !== null && typeof b.allow !== 'boolean') throw new HttpError(400, 'allow must be true, false or null');
    const co = companyOf(me);
    const target = typeof b.target === 'string' ? b.target.trim() : '';
    const member = typeof b.member === 'string' ? b.member.trim().toLowerCase() : '';
    const admin = await isAdminUser(me);
    switch (b.scope) {
      case 'company':
        if (!admin) throw new HttpError(403, 'Only company admins can change company-wide rights');
        return { feature: b.feature!, scope: 'company', target: '', member: '', allow: b.allow! };
      case 'department': {
        if (!admin) throw new HttpError(403, 'Only company admins can change department rights');
        const dept = (await getDepartments(co)).find((d) => sameName(d, target));
        if (!dept) throw new HttpError(404, 'department not found');
        return { feature: b.feature!, scope: 'department', target: dept, member: '', allow: b.allow! };
      }
      case 'user': {
        if (!admin) throw new HttpError(403, 'Only company admins can change a person’s rights everywhere');
        const u = await colleague(me, target);
        if (!u) throw new HttpError(404, 'user not found');
        return { feature: b.feature!, scope: 'user', target: u.username, member: '', allow: b.allow! };
      }
      case 'group': {
        const g = GROUP_ID_RE.test(target) ? await db.getGroup(target) : undefined;
        if (!g || !(await mayManageGroup(me, g))) throw new HttpError(404, 'group not found');
        if (member && !g.members.includes(member)) throw new HttpError(400, `${shortId(member)} is not in this group`);
        return { feature: b.feature!, scope: 'group', target: g.id, member, allow: b.allow! };
      }
      default:
        throw new HttpError(400, 'scope must be company, department, group or user');
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

  /** A birth date "YYYY-MM-DD" ('' = none), not in the future. */
  function checkBirthday(v: unknown): string {
    if (v === undefined || v === null || v === '') return '';
    if (typeof v !== 'string' || !BIRTHDAY_RE.test(v) || v > new Date().toISOString().slice(0, 10)) {
      throw new HttpError(400, 'Birth date: choose a valid date');
    }
    return v;
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
    await db.setInvite(username, { hash: await hashPassword(token), expires });
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

  /** Groups of a company: those its admins made. */
  const companyGroups = async (company: string) => (await db.listGroups()).filter((g) => companyOf(g.created_by) === company);

  // ---- channels and communities (JSON in meta, per company) ----
  /** Which groups are channels: one-way, anyone may follow, only their admins post. */
  async function channelIds(company: string): Promise<Set<string>> {
    return new Set(parseList(await db.getMeta(metaKey('channels', company))));
  }
  async function getCommunities(company: string): Promise<Community[]> {
    try {
      const list = JSON.parse((await db.getMeta(metaKey('communities', company))) ?? '[]') as unknown;
      return Array.isArray(list) ? (list as Community[]) : [];
    } catch {
      return [];
    }
  }
  /** A group as apps see it: with whether it is a channel and which community it is in. */
  async function infoOf(g: GroupRow, cache?: { channels: Set<string>; communities: Community[] }): Promise<GroupInfo> {
    const co = companyOf(g.created_by);
    const channels = cache?.channels ?? (await channelIds(co));
    const communities = cache?.communities ?? (await getCommunities(co));
    const community = communities.find((c) => c.groups.includes(g.id))?.id;
    return { ...toGroupInfo(g), ...(channels.has(g.id) ? { kind: 'channel' as const } : {}), ...(community ? { community } : {}) };
  }
  async function infoCache(company: string) {
    return { channels: await channelIds(company), communities: await getCommunities(company) };
  }

  /** Group admins: a list of members ([] = none). */
  function checkGroupAdmins(v: unknown, members: string[]): string[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new HttpError(400, 'admins must be a list of IDs');
    return [...new Set(v.map((u) => String(u).trim().toLowerCase()))].filter((u) => members.includes(u)).sort();
  }

  /** Change a group (company admin or group admin): name, members, senders, group admins. Fields left out stay. */
  async function updateGroupFrom(me: string, group: GroupRow, raw: unknown): Promise<GroupInfo> {
    const co = companyOf(group.created_by);
    const body = (raw ?? {}) as { name?: unknown; members?: unknown; senders?: unknown; admins?: unknown };
    const name = body.name === undefined ? undefined : checkGroupName(body.name);
    const members = body.members === undefined ? undefined : await existingMembers(checkMemberList(body.members), co);
    const finalMembers = members ?? group.members;
    // Not sent: keep the current rule, minus anyone who left the group.
    const senders =
      body.senders !== undefined ? checkSenders(body.senders, finalMembers) : group.senders && group.senders.filter((u) => finalMembers.includes(u));
    const admins = body.admins !== undefined ? checkGroupAdmins(body.admins, finalMembers) : group.admins.filter((u) => finalMembers.includes(u));
    // A channel: only its admins post (company admins always may).
    const channel = (await channelIds(co)).has(group.id);
    // A group admin can't take the group away from themselves by mistake (a company admin can).
    if (!(await isAdminUser(me)) && !admins.includes(me)) throw new HttpError(400, 'You would no longer be able to manage this group');
    await db.updateGroup(group.id, { name, members, senders: channel ? admins : senders, admins });
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
    if (JSON.stringify(admins) !== JSON.stringify(group.admins)) details.push(`group admins: ${admins.join(', ') || 'none'}`);
    await audit(me, 'group.update', name ?? group.name, details.join('; '));
    await notify([...new Set([...group.members, ...(members ?? [])])], 'groups');
    return infoOf((await db.getGroup(group.id))!);
  }

  // ---- help desk contacts (JSON in meta, per company) ----
  async function getHelpDesk(company: string): Promise<HelpContact[]> {
    try {
      const list = JSON.parse((await db.getMeta(metaKey('helpdesk', company))) ?? '[]') as unknown;
      return Array.isArray(list) ? (list as HelpContact[]) : [];
    } catch {
      return [];
    }
  }
  function checkHelpContacts(v: unknown, company: string): HelpContact[] {
    if (!Array.isArray(v) || v.length > MAX_HELP_CONTACTS) throw new HttpError(400, `Up to ${MAX_HELP_CONTACTS} contacts`);
    return v.map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      const field = (k: string) => {
        const s = c[k] === undefined || c[k] === null ? '' : c[k];
        if (typeof s !== 'string' || s.trim().length > MAX_HELP_FIELD) throw new HttpError(400, `${k}: at most ${MAX_HELP_FIELD} characters`);
        return s.trim().replace(/\s+/g, ' ');
      };
      const title = field('title');
      if (!title) throw new HttpError(400, 'Every contact needs a title, e.g. "IT support"');
      const { phone, email } = checkContactInfo(c.phone, c.email);
      const username = field('username').toLowerCase();
      if (username && (!USERNAME_RE.test(username) || companyOf(username) !== company)) throw new HttpError(400, `Unknown ID: ${username}`);
      const id = typeof c.id === 'string' && /^[0-9a-f]{16}$/.test(c.id) ? c.id : randomBytes(8).toString('hex');
      return { id, title, name: field('name'), department: field('department'), phone, email, hours: field('hours'), username };
    });
  }

  /** For the web page: the invite as a code to send and as a QR picture. */
  async function inviteExtras(req: http.IncomingMessage, invite: InviteResponse) {
    const proto = config.trustProxy ? String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0] : 'http';
    const code = inviteCode(config.publicUrl || `${proto}://${req.headers.host}`, invite);
    return { code, qrSvg: await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
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
  const reportLimit = new RateLimiter(20, 3600_000);
  const backupLimit = new RateLimiter(60, 3600_000);
  const backupOpLimit = new RateLimiter(3000, 3600_000);

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

  // ---- the web app at /app/ ----
  const appDir = resolvePath(config.appDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'desktop', 'web', 'dist'));
  const APP_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
  };
  async function serveApp(rel: string, res: http.ServerResponse) {
    let name: string;
    try {
      name = decodeURIComponent(rel || 'index.html');
    } catch {
      throw new HttpError(400, 'bad path');
    }
    const file = resolvePath(appDir, name);
    // Only files inside the app folder, nothing hidden.
    if (!file.startsWith(appDir + sep) || /(^|[\\/])\./.test(name)) throw new HttpError(404, 'not found');
    const type = APP_TYPES[extname(file).toLowerCase()];
    let body: Buffer;
    try {
      body = await fs.readFile(type ? file : join(appDir, 'index.html'));
    } catch {
      // A path inside the app (no file of that name): the app itself.
      body = await fs.readFile(join(appDir, 'index.html')).catch(() => {
        throw new HttpError(404, 'The web app is not installed on this server');
      });
    }
    // Hashed files never change; the page and the service worker are always fetched fresh.
    const immutable = name.startsWith('assets/');
    res.writeHead(200, {
      'content-type': type ?? 'text/html; charset=utf-8',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-frame-options': 'DENY',
      ...(name === 'sw.js' ? { 'service-worker-allowed': '/app/' } : {}),
    });
    res.end(body);
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
    // The web app (iPhone: Safari > Add to Home Screen, or any browser): static files built from apps/desktop/web.
    if (method === 'GET' && (path === '/' || path === '/app' || path.startsWith('/app/'))) {
      if (path === '/' || path === '/app') {
        res.writeHead(301, { location: '/app/' });
        return res.end();
      }
      return serveApp(path.slice('/app/'.length), res);
    }
    const page = method === 'GET' ? WEB_FILES[path] : undefined;
    if (page) {
      res.writeHead(200, { 'content-type': page[1], 'content-security-policy': WEB_CSP, 'x-frame-options': 'DENY' });
      const body = await fs.readFile(join(WEB_DIR, page[0]));
      // The contact address on the public pages (SUPPORT_EMAIL).
      const support = (config.supportEmail ?? 'hello.cellbtech@gmail.com').replace(/[<>"'&]/g, '');
      return res.end(page[0].endsWith('.html') ? body.toString('utf8').replaceAll('{{support}}', support) : body);
    }
    // Super admin web page: sign in with company code + ID + password (the login password, never the device secret).
    if (method === 'POST' && path === '/v1/super/setup') {
      const ip = clientIp(req);
      if (authFailLimit.isBlocked(ip)) throw new HttpError(429, 'Too many attempts, try again later');
      const body = (await readJson(req)) as { code?: unknown; username?: unknown; password?: unknown };
      const expected = await setupCode();
      if (!expected) throw new HttpError(409, 'The owner account already exists. Sign in instead.');
      if (typeof body.code !== 'string' || body.code.trim() !== expected) {
        authFailLimit.allow(ip);
        throw new HttpError(401, 'Wrong setup code. It is in the server log.');
      }
      if (typeof body.username !== 'string' || !ID_RE.test(body.username)) {
        throw new HttpError(400, ID_RULES);
      }
      checkNewPassword(body.password);
      const hash = await hashPassword(body.password as string);
      if (!(await db.getUser(body.username))) await db.createPendingUser(body.username, hash);
      await db.setPassword(body.username, hash, false);
      await db.setMeta('super_admins', JSON.stringify([body.username]));
      await db.setMeta('setup_code', '');
      await audit(body.username, 'super.setup', body.username, 'owner account created');
      return send(204);
    }
    if (path === '/v1/super/session') {
      if (method === 'DELETE') {
        const t = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        webSessions.delete(tokenHash(t));
        return send(204);
      }
      if (method === 'POST') {
        const ip = clientIp(req);
        if (authFailLimit.isBlocked(ip)) throw new HttpError(429, 'Too many attempts, try again later');
        const body = (await readJson(req)) as { username?: unknown; password?: unknown };
        const user = typeof body.username === 'string' && USERNAME_RE.test(body.username) ? await db.getUser(body.username) : undefined;
        const ok =
          !!user &&
          !user.banned &&
          typeof body.password === 'string' &&
          await verifyPassword(body.password, user.pass_hash) &&
          (await superAdmins()).includes(user.username);
        if (!ok) {
          authFailLimit.allow(ip);
          throw new HttpError(401, 'Wrong company, ID or password (or not the server owner)');
        }
        for (const [k, s] of webSessions) if (s.until < Date.now()) webSessions.delete(k);
        const token = randomBytes(32).toString('base64url');
        const expires = Date.now() + WEB_SESSION_MS;
        webSessions.set(tokenHash(token), { user: user!.username, until: expires });
        await audit(user!.username, 'super.web_login', user!.username, 'signed in on the web page');
        return send(200, { token, username: user!.username, expires });
      }
    }
    if (method === 'GET' && path === '/v1/config') {
      const pub: PublicConfig = {
        openRegistration: config.openRegistration,
        certKey: toBase64((await certKey).pub),
        ...(config.publicUrl ? { serverUrl: config.publicUrl } : {}),
        needsSetup: !(await superAdmins()).length,
        vapidKey: (await webPush.catch(() => null))?.keys.publicKey,
      };
      return send(200, pub);
    }

    if (method === 'POST' && path === '/v1/login') {
      const ip = clientIp(req);
      if (authFailLimit.isBlocked(ip)) throw new HttpError(429, 'Too many attempts, try again later');
      const body = (await readJson(req)) as Partial<LoginRequest>;
      const user = typeof body.username === 'string' ? await db.getUser(body.username) : undefined;
      if (!user || typeof body.password !== 'string' || !(await verifyPassword(body.password, user.pass_hash))) {
        authFailLimit.allow(ip);
        throw new HttpError(401, 'Wrong ID or password');
      }
      if (user.banned) throw new HttpError(403, accountClosed(user));
      const closed = await companyClosed(user.username);
      if (closed) throw new HttpError(403, closed);
      let newHash: string | null = null;
      if (user.must_change) {
        if (body.newPassword === undefined) throw new HttpError(403, 'must_change');
        checkNewPassword(body.newPassword, body.password);
        newHash = await hashPassword(body.newPassword);
      }
      if (typeof body.deviceSecret !== 'string' || body.deviceSecret.length < 32 || body.deviceSecret.length > 128) {
        throw new HttpError(400, 'invalid device secret');
      }
      const identityKey = b64Key(body.identityKey, 32, 'identityKey');
      const spk = checkSpk(identityKey, body.signedPreKey);
      const opks = checkOpks(body.oneTimePreKeys ?? []);
      await db.activate(user.username, { deviceHash: await hashPassword(body.deviceSecret), identityKey, spk }, opks);
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
        await verifyPassword(body.token, user.invite_hash);
      if (!valid) {
        authFailLimit.allow(ip);
        throw new HttpError(401, 'This QR code is not valid any more. Ask your admin for a new one.');
      }
      if (user!.banned) throw new HttpError(403, accountClosed(user!));
      const closed = await companyClosed(user!.username);
      if (closed) throw new HttpError(403, closed);
      checkNewPassword(body.newPassword);
      if (typeof body.deviceSecret !== 'string' || body.deviceSecret.length < 32 || body.deviceSecret.length > 128) {
        throw new HttpError(400, 'invalid device secret');
      }
      const identityKey = b64Key(body.identityKey, 32, 'identityKey');
      const spk = checkSpk(identityKey, body.signedPreKey);
      const opks = checkOpks(body.oneTimePreKeys ?? []);
      await db.activate(user!.username, { deviceHash: await hashPassword(body.deviceSecret), identityKey, spk }, opks);
      await db.setPassword(user!.username, await hashPassword(body.newPassword as string), false);
      await db.setInvite(user!.username, null);
      await kick(user!.username, 4004, 'logged in on another device');
      await notifyGroupsOf(user!.username);
      await audit(user!.username, 'user.join', user!.username, 'joined with a QR invite');
      return send(200, { ok: true });
    }

    if (method === 'POST' && path === '/v1/register') {
      if (!registerLimit.allow(clientIp(req))) throw new HttpError(429, 'too many registrations');
      const body = (await readJson(req)) as Partial<RegisterRequest>;
      // A self-chosen account never has a company part: only admins put people into companies.
      if (typeof body.username !== 'string' || !ID_RE.test(body.username)) {
        throw new HttpError(400, 'invalid username');
      }
      const setup = body.company;
      let company: Company | null = null;
      if (setup !== undefined) {
        // Anyone may ask for a company from the app; it stays closed until the server owner approves it.
        const code = checkCompanyCode((setup as { code?: unknown } | null)?.code);
        const name = checkCompanyName((setup as { name?: unknown } | null)?.name);
        if ((await listCompanies()).some((c) => c.code === code)) {
          throw new HttpError(409, `The company code "${code}" is already used. Choose another.`);
        }
        company = { code, name, createdAt: Date.now(), status: 'pending' };
      } else if (!config.openRegistration && !config.adminUsers.includes(body.username)) {
        throw new HttpError(403, 'Sign-up is closed. Ask your admin for an ID and password, then use Log in.');
      }
      if (typeof body.password !== 'string' || body.password.length < 32 || body.password.length > 128) {
        throw new HttpError(400, 'invalid password');
      }
      if (body.loginPassword !== undefined) checkNewPassword(body.loginPassword);
      const identityKey = b64Key(body.identityKey, 32, 'identityKey');
      const spk = checkSpk(identityKey, body.signedPreKey);
      const opks = checkOpks(body.oneTimePreKeys ?? []);
      const username = makeUsername(body.username, company?.code ?? '');
      if (await db.getUser(username)) throw new HttpError(409, 'username taken');
      const passHash = typeof body.loginPassword === 'string' ? await hashPassword(body.loginPassword) : undefined;
      await db.createUser({ username, deviceHash: await hashPassword(body.password), passHash, identityKey, spk }, opks);
      if (company) {
        await saveCompanies([...(await listCompanies()), company]);
        await setAdmins(company.code, [username]);
        await db.setMeta(metaKey('owner', company.code), username);
        await audit(username, 'company.request', company.code, `${company.name}: waiting for approval`);
      }
      return send(200, { ok: true, username, pending: company?.status === 'pending' });
    }

    // Sealed sender: NO login, so the server never learns who is sending. Allowed only with the
    // recipient's delivery key, which they share with their contacts inside encrypted messages.
    let sm: RegExpMatchArray | null;
    if (method === 'POST' && (sm = path.match(SEALED_PATH))) {
      if (!sealedLimit.allow(clientIp(req))) throw new HttpError(429, 'slow down');
      const to = userSeg(sm[1]!);
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
    const authz = String(req.headers.authorization ?? '');
    const me = authz.startsWith('Bearer ') && path.startsWith('/v1/super/') ? webSessionUser(authz.slice(7)) : await basicAuth(req);

    let m: RegExpMatchArray | null;
    if (method === 'GET' && path === '/v1/keys/count') {
      return send(200, { count: await db.countOneTimePreKeys(me) });
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/keys\/([^/]+)$/))) {
      const user = await colleague(me, userSeg(m[1]!));
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
      if (!q || q.length > 32) return send(200, { users: [] });
      const users = (await companyUsers(companyOf(me)))
        .filter((u) => u.username !== me && shortId(u.username).startsWith(q) && isActive(u) && !u.banned)
        .slice(0, 20)
        .map((u) => u.username);
      return send(200, { users });
    }
    // The company directory: everyone I can message, with their department, for the "New chat" list.
    if (method === 'GET' && path === '/v1/directory') {
      const co = companyOf(me);
      const rules = await getRules(co);
      const admins = await adminsOf(co);
      const users: UserProfile[] = (await companyUsers(co))
        .filter((u) => u.username !== me && isActive(u) && !u.banned)
        .map((u) => ({
          username: u.username,
          name: u.display_name,
          active: true,
          departments: u.departments,
          phone: u.phone,
          email: u.email,
          about: u.about,
          birthday: u.birthday,
          editDelete: admins.includes(u.username) || resolveRight(rules, 'editDelete', { username: u.username, departments: u.departments }),
        }));
      return send(200, { users });
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/users\/([^/]+)$/))) {
      const u = await colleague(me, userSeg(m[1]!));
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
        about: u.about,
        birthday: u.birthday,
        editDelete:
          (await isAdminUser(u.username)) ||
          resolveRight(await getRules(companyOf(me)), 'editDelete', { username: u.username, departments: u.departments }),
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
        if (body.token.startsWith(WEB_PUSH_PREFIX)) {
          // A browser's Web Push subscription (web app).
          if (!parseSubscription(body.token)) throw new HttpError(400, 'invalid web push subscription');
          token = body.token;
        } else if (body.token.startsWith(APNS_PREFIX)) {
          // The iPhone app: Apple tokens for notifications and for calls (apns.ts).
          if (!parseAppleToken(body.token)) throw new HttpError(400, 'invalid Apple push token');
          token = body.token;
        } else {
          // Kept with the token, so it is cleared with it (new device, logout): see push.ts.
          token = body.callUi === true ? `${CALL_UI_PREFIX}${body.token}` : body.token;
        }
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
        isAdmin: await isAdminUser(me),
        admins: await adminsOf(companyOf(me)),
        policy: await getPolicy(companyOf(me)),
        canShare: canShare(user),
        avatar: user.avatar_ver,
        phone: user.phone,
        email: user.email,
        name: user.display_name,
        company: await companyInfo(companyOf(me)),
        isSuper: (await superAdmins()).includes(me),
        rights: await rightsOf(user),
        about: user.about,
        hideLastSeen: !!user.hide_last_seen,
        birthday: user.birthday,
      };
      return send(200, me_);
    }
    // Profiles are made by the admin and locked: only admins may change their own details (employees ask the
    // admin). On a server without admins people manage their own.
    const profileLocked = (await adminsOf(companyOf(me))).length > 0 && !(await isAdminUser(me));
    // Their own profile photo: only with the admin's "Profile photo" permission (admins always may).
    const photoLocked =
      profileLocked &&
      (path === '/v1/avatar'
        ? !resolveRight(await getRules(companyOf(me)), 'profilePhoto', { username: me, departments: (await db.getUser(me))!.departments })
        : true);
    // My own privacy choices (not locked by the admin): About line, hide last seen.
    if (method === 'PUT' && path === '/v1/me/privacy') {
      const body = (await readJson(req)) as Partial<PrivacyRequest>;
      const p: { about?: string; hideLastSeen?: boolean } = {};
      if (body.about !== undefined) {
        if (typeof body.about !== 'string' || body.about.trim().length > MAX_ABOUT || /[\u0000-\u001f\u007f]/.test(body.about)) {
          throw new HttpError(400, `About: at most ${MAX_ABOUT} characters`);
        }
        p.about = body.about.trim();
      }
      if (body.hideLastSeen !== undefined) {
        if (typeof body.hideLastSeen !== 'boolean') throw new HttpError(400, 'hideLastSeen must be true or false');
        p.hideLastSeen = body.hideLastSeen;
      }
      if (body.birthday !== undefined) await db.setBirthday(me, checkBirthday(body.birthday));
      await db.setPrivacy(me, p);
      return send(204);
    }
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
      if (photoLocked) throw new HttpError(403, 'Only your admin can change your profile photo (or allow you to)');
      if (!uploadLimit.allow(me)) throw new HttpError(429, 'too many uploads');
      const photo = checkPhoto(await readJson(req, Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 1024));
      const ver = Date.now();
      await db.setAvatar(me, { ...photo, ver });
      return send(200, { ver });
    }
    if (path === '/v1/avatar' && method === 'DELETE') {
      if (photoLocked) throw new HttpError(403, 'Only your admin can change your profile photo (or allow you to)');
      await db.setAvatar(me, null);
      return send(204);
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/avatars\/([^/]+)$/))) {
      const owner = userSeg(m[1]!);
      const a = sameCompany(me, owner) ? await db.getAvatar(owner) : undefined;
      if (!a) throw new HttpError(404, 'no photo');
      const out: AvatarResponse = a;
      return send(200, out);
    }
    // ---- catalogs (like WhatsApp Business): everyone has their own and changes only that; colleagues may
    // browse a person's catalog from their profile ----
    if (method === 'GET' && path === '/v1/catalog') {
      const owner = url.searchParams.get('owner') ?? me;
      if (!USERNAME_RE.test(owner)) throw new HttpError(400, 'invalid owner');
      if (!sameCompany(me, owner)) return send(200, { products: [] });
      return send(200, { products: (await db.listProducts(owner)).map(toProductInfo) });
    }
    if (method === 'GET' && (m = path.match(/^\/v1\/catalog\/([0-9a-f]{16})\/photo$/))) {
      const product = await db.getProduct(m[1]!);
      const photo = product && sameCompany(me, product.owner) ? await db.getProductPhoto(product.id) : undefined;
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
      const isAdmin = sameCompany(me, product.owner) && (await isAdminUser(me));
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
      const names = [...new Set((url.searchParams.get('u') ?? '').split(',').filter((u) => USERNAME_RE.test(u) && sameCompany(me, u)))];
      if (names.length > 200) throw new HttpError(400, 'too many users');
      const out: Record<string, Presence> = {};
      // Like WhatsApp: whoever hides their last seen can't see anyone else's either.
      const iHide = !!(await db.getUser(me))?.hide_last_seen;
      for (const u of await Promise.all(names.map((n) => db.getUser(n)))) {
        if (u) {
          const hidden = iHide || !!u.hide_last_seen;
          out[u.username] = {
            online: hidden ? false : isOnline(u),
            lastSeen: hidden || u.last_seen === null ? null : Number(u.last_seen),
            avatar: u.avatar_ver,
          };
        }
      }
      return send(200, out);
    }
    if (method === 'GET' && path === '/v1/groups') {
      // Members can only exchange messages with people who have logged in and are not suspended.
      const reachable = new Set((await companyUsers(companyOf(me))).filter((u) => isActive(u) && !u.banned).map((u) => u.username));
      const cache = await infoCache(companyOf(me));
      const groups = await Promise.all(
        (await db.groupsOf(me)).map(async (g) => ({ ...(await infoOf(g, cache)), members: g.members.filter((u) => reachable.has(u)) })),
      );
      return send(200, { groups });
    }

    // ---- rights: company admins manage all of them, group admins those of their own groups ----
    if (path === '/v1/rights') {
      const co = companyOf(me);
      if (method === 'GET') {
        const group = url.searchParams.get('group');
        const rules = await getRules(co);
        if (group) {
          const g = GROUP_ID_RE.test(group) ? await db.getGroup(group) : undefined;
          if (!g || !(await mayManageGroup(me, g))) throw new HttpError(404, 'group not found');
          return send(200, { rules: rules.filter((r) => r.scope === 'group' && r.target === g.id) });
        }
        if (!(await isAdminUser(me))) throw new HttpError(403, 'admin only');
        return send(200, { rules });
      }
      if (method === 'PUT') {
        const change = await checkRightChange(me, await readJson(req));
        const same = (r: RightRule) =>
          r.feature === change.feature && r.scope === change.scope && r.target === change.target && r.member === (change.member ?? '');
        const stored = (await getRules(co)).filter((r) => !same(r));
        if (change.allow !== null) {
          stored.push({ ...change, member: change.member ?? '', allow: change.allow, setBy: me, setAt: Date.now() });
        }
        await saveRules(co, stored);
        const who = change.scope === 'company' ? 'everyone' : [change.scope, change.target && shortId(change.target), change.member && shortId(change.member)].filter(Boolean).join(' ');
        const state = change.allow === null ? 'back to default' : change.allow ? 'allowed' : 'blocked';
        await audit(me, 'rights.update', change.feature, `${who}: ${state}`);
        const g = change.scope === 'group' ? await db.getGroup(change.target) : undefined;
        await notify(g ? g.members : (await companyUsers(co)).map((u) => u.username), 'policy');
        return send(200, { rules: (await getRules(co)).filter((r) => !g || (r.scope === 'group' && r.target === g.id)) });
      }
    }

    // A group admin (or company admin) changes the group: name, members, who may send, who else is group admin.
    if (method === 'PUT' && (m = path.match(/^\/v1\/groups\/([0-9a-f]{16})$/))) {
      const group = await db.getGroup(m[1]!);
      if (!group || !(await mayManageGroup(me, group))) throw new HttpError(404, 'group not found');
      const updated = await updateGroupFrom(me, group, await readJson(req));
      return send(200, updated);
    }

    // ---- block list (the app hides and refuses blocked people) and reports to the admins ----
    if (path === '/v1/me/blocked' && (method === 'GET' || method === 'PUT')) {
      const key = `blocked:${me}`;
      if (method === 'PUT') {
        const users = ((await readJson(req)) as { users?: unknown }).users;
        if (!Array.isArray(users) || users.length > 1000 || users.some((u) => typeof u !== 'string' || !USERNAME_RE.test(u))) {
          throw new HttpError(400, 'invalid block list');
        }
        await db.setMeta(key, JSON.stringify([...new Set(users as string[])].filter((u) => u !== me)));
        return send(204);
      }
      return send(200, { users: parseList(await db.getMeta(key)) });
    }
    if (method === 'POST' && path === '/v1/report') {
      if (!reportLimit.allow(me)) throw new HttpError(429, 'Too many reports, try again later');
      const body = (await readJson(req)) as Record<string, unknown>;
      const user = body.user;
      if (typeof user !== 'string' || !USERNAME_RE.test(user) || !(await db.getUser(user))) throw new HttpError(400, 'unknown user');
      // About someone else, or about myself only to ask for my account to be deleted.
      const reasonOk = user === me ? body.reason === DELETE_REQUEST : (REPORT_REASONS as readonly string[]).includes(body.reason as string);
      if (typeof body.reason !== 'string' || !reasonOk) throw new HttpError(400, 'invalid reason');
      const details = typeof body.details === 'string' ? body.details.trim().slice(0, 1000) : '';
      const chat = typeof body.chat === 'string' && body.chat.length <= 80 ? body.chat : undefined;
      const messages = (Array.isArray(body.messages) ? body.messages : [])
        .slice(-MAX_REPORT_MESSAGES)
        .filter((m): m is { from: string; text: string; ts: number } => {
          const x = m as Record<string, unknown>;
          return typeof x.from === 'string' && USERNAME_RE.test(x.from) && typeof x.text === 'string' && typeof x.ts === 'number';
        })
        .map((m) => ({ from: m.from, text: m.text.slice(0, 2000), ts: m.ts }));
      // To the admins of the reported person's company (the owner's for people without one).
      const co = companyOf(user);
      const report: Report = { id: randomBytes(8).toString('hex'), ts: Date.now(), by: me, user, reason: body.reason, details, chat, messages, status: 'open' };
      const list = JSON.parse((await db.getMeta(metaKey('reports', co))) ?? '[]') as Report[];
      list.unshift(report);
      await db.setMeta(metaKey('reports', co), JSON.stringify(list.slice(0, 300)));
      await audit(me, user === me ? 'report.delete_request' : 'report.create', user, body.reason);
      return send(201, { id: report.id });
    }

    // ---- help desk: whom to call for what; everyone may read it, company admins edit it ----
    if (method === 'GET' && path === '/v1/helpdesk') {
      return send(200, { contacts: await getHelpDesk(companyOf(me)) });
    }

    // ---- channels: every channel of my company, to follow or leave; communities: how groups are put together ----
    if (method === 'GET' && path === '/v1/channels') {
      const co = companyOf(me);
      const cache = await infoCache(co);
      const channels: ChannelInfo[] = [];
      for (const g of await companyGroups(co)) {
        if (!cache.channels.has(g.id)) continue;
        const info = await infoOf(g, cache);
        channels.push({ id: g.id, name: g.name, followers: g.members.length, following: g.members.includes(me), ...(info.community ? { community: info.community } : {}) });
      }
      return send(200, { channels: channels.sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (method === 'POST' && (m = path.match(/^\/v1\/channels\/([0-9a-f]{16})\/follow$/))) {
      const g = await db.getGroup(m[1]!);
      if (!g || companyOf(g.created_by) !== companyOf(me) || !(await channelIds(companyOf(me))).has(g.id)) throw new HttpError(404, 'channel not found');
      const follow = ((await readJson(req)) as { follow?: unknown }).follow;
      if (typeof follow !== 'boolean') throw new HttpError(400, 'follow must be true or false');
      if (follow && !g.members.includes(me)) {
        if (g.members.length >= MAX_GROUP_MEMBERS) throw new HttpError(400, 'This channel is full');
        await db.updateGroup(g.id, { members: [...g.members, me].sort() });
      } else if (!follow && g.members.includes(me)) {
        await db.updateGroup(g.id, { members: g.members.filter((u) => u !== me), admins: g.admins.filter((u) => u !== me), senders: (g.senders ?? []).filter((u) => u !== me) });
      }
      await notify([...new Set([...g.members, me])], 'groups');
      return send(204);
    }
    if (method === 'GET' && path === '/v1/communities') {
      return send(200, { communities: await getCommunities(companyOf(me)) });
    }
    // ---- live backup: each change as a small encrypted record, until the next full backup takes them in ----
    if (path === '/v1/backup/ops') {
      if (method === 'POST') {
        if (!backupOpLimit.allow(me)) throw new HttpError(429, 'too many backup changes');
        const data = ((await readJson(req, MAX_BACKUP_OP + 1024)) as { data?: unknown }).data;
        if (typeof data !== 'string' || !data || data.length > MAX_BACKUP_OP || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
          throw new HttpError(400, 'invalid backup change');
        }
        // Too many since the last full backup: the app sends a full one instead (409).
        if ((await db.countBackupOps(me)) >= MAX_BACKUP_OPS) throw new HttpError(409, 'full backup needed');
        return send(200, { id: await db.addBackupOp(me, data) });
      }
      if (method === 'GET') {
        const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
        const ops = await db.listBackupOps(me, after, 500);
        return send(200, { ops, next: ops.length === 500 ? ops[ops.length - 1]!.id : null });
      }
    }
    // ---- my chat history backup: ciphertext only (see HistoryBackup) ----
    if (path === '/v1/backup') {
      if (method === 'GET') {
        const b = await db.getBackup(me);
        if (!b) throw new HttpError(404, 'no backup');
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(b.data);
      }
      if (method === 'PUT') {
        if (!backupLimit.allow(me)) throw new HttpError(429, 'too many backups');
        const text = await readBody(req, MAX_BACKUP_CHARS + 4096);
        let b: Partial<HistoryBackup>;
        try {
          b = JSON.parse(text) as Partial<HistoryBackup>;
        } catch {
          throw new HttpError(400, 'invalid json');
        }
        const b64 = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(v);
        if (!b64(b.data) || !b64(b.wrap) || !b64(b.salt) || !Number.isInteger(b.v)) throw new HttpError(400, 'invalid backup');
        const upTo = Number.isInteger(b.upTo) && b.upTo! > 0 ? b.upTo! : 0;
        const clean: HistoryBackup = { data: b.data!, wrap: b.wrap!, salt: b.salt!, v: b.v!, updatedAt: Date.now(), ...(upTo ? { upTo } : {}) };
        await db.putBackup(me, JSON.stringify(clean));
        // The full backup holds every change up to upTo: those records are no longer needed.
        if (upTo) await db.pruneBackupOps(me, upTo);
        return send(200, { updatedAt: clean.updatedAt });
      }
      if (method === 'DELETE') {
        await db.deleteBackup(me);
        return send(204);
      }
    }
    // Is this my login password? (The app needs it once to lock the chat backup.) Counts as a failed attempt if not.
    if (method === 'POST' && path === '/v1/password/check') {
      const ip = clientIp(req);
      if (authFailLimit.isBlocked(ip)) throw new HttpError(429, 'Too many attempts, try again later');
      const body = (await readJson(req)) as { password?: unknown };
      const user = (await db.getUser(me))!;
      if (typeof body.password !== 'string' || !(await verifyPassword(body.password, user.pass_hash))) {
        authFailLimit.allow(ip);
        throw new HttpError(401, 'That password is wrong');
      }
      return send(204);
    }
    if (method === 'POST' && path === '/v1/password') {
      const body = (await readJson(req)) as { oldPassword?: unknown; newPassword?: unknown };
      const user = (await await db.getUser(me))!;
      if (typeof body.oldPassword !== 'string' || !(await verifyPassword(body.oldPassword, user.pass_hash))) {
        authFailLimit.allow(clientIp(req));
        throw new HttpError(401, 'Current password is wrong');
      }
      checkNewPassword(body.newPassword, body.oldPassword);
      await db.setPassword(me, await hashPassword(body.newPassword as string), false);
      return send(204);
    }

    // ---- super admin: companies, and moving people between them ----
    if (path.startsWith('/v1/super/')) {
      if (!(await superAdmins()).includes(me)) throw new HttpError(403, 'super admin only');

      if (method === 'GET' && path === '/v1/super/companies') {
        const users = await db.listUsers();
        const companies: CompanyInfo[] = [];
        for (const c of await listCompanies()) {
          const people = users.filter((u) => companyOf(u.username) === c.code && u.banned !== MOVED);
          companies.push({ ...c, status: c.status ?? 'active', users: people.length, admins: await adminsOf(c.code) });
        }
        companies.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
        return send(200, { companies });
      }
      if (method === 'POST' && path === '/v1/super/companies') {
        // A new company and its first admin, who joins with the QR invite and chooses their own password.
        const body = (await readJson(req)) as Partial<NewCompanyRequest>;
        const code = checkCompanyCode(body.code);
        const name = checkCompanyName(body.name);
        if (typeof body.adminId !== 'string' || !ID_RE.test(body.adminId)) {
          throw new HttpError(400, 'Admin ID must be 3-32 characters: a-z, 0-9, _ or .');
        }
        const adminName = checkName(body.adminName);
        const list = await listCompanies();
        if (list.some((c) => c.code === code)) throw new HttpError(409, `The company code "${code}" is already used`);
        const username = makeUsername(body.adminId, code);
        const company = { code, name, createdAt: Date.now() };
        await saveCompanies([...list, company]);
        // Their admin signs in with company code + ID + this temporary password (then chooses their own), or scans the QR.
        const tempPassword = generatePassword();
        await db.createPendingUser(username, await hashPassword(tempPassword), { name: adminName });
        await setAdmins(code, [username]);
        await db.setMeta(metaKey('owner', code), username);
        const invite = await newInvite(username);
        await audit(me, 'company.create', code, `${name}; first admin: ${body.adminId}`);
        const info: CompanyInfo = { ...company, status: 'active', users: 1, admins: [username] };
        return send(200, { company: info, invite, tempPassword, ...(await inviteExtras(req, invite)) });
      }
      if ((m = path.match(/^\/v1\/super\/companies\/([a-z0-9]{2,16})(\/users|\/invite|\/status)?$/))) {
        const company = await getCompany(m[1]!);
        if (!company) throw new HttpError(404, 'company not found');
        // Approve a company that asked to join (active), suspend one (its people are cut off, nothing is deleted),
        // or let it back in.
        if (method === 'PUT' && m[2] === '/status') {
          const status = ((await readJson(req)) as { status?: unknown }).status;
          if (status !== 'active' && status !== 'suspended') throw new HttpError(400, 'status must be active or suspended');
          const people = (await companyUsers(company.code)).map((u) => u.username);
          if (people.includes(me)) throw new HttpError(400, "You can't suspend your own company");
          await saveCompanies((await listCompanies()).map((c) => (c.code === company.code ? { ...c, status } : c)));
          if (status === 'suspended') for (const u of people) await kick(u, 4007, 'company suspended');
          const action = status === 'suspended' ? 'company.suspend' : company.status === 'pending' ? 'company.approve' : 'company.resume';
          await audit(me, action, company.code, company.name);
          return send(204);
        }
        // Turn down a request: the company and the account made with it are deleted.
        if (method === 'DELETE' && !m[2]) {
          if (company.status !== 'pending') throw new HttpError(400, 'Only a company waiting for approval can be turned down');
          for (const u of await companyUsers(company.code)) {
            await db.deleteUser(u.username);
            await kick(u.username, 4001, 'company request turned down');
          }
          await saveCompanies((await listCompanies()).filter((c) => c.code !== company.code));
          await db.setMeta(metaKey('admins', company.code), '[]');
          await audit(me, 'company.reject', company.code, company.name);
          return send(204);
        }
        if (method === 'PUT' && !m[2]) {
          const name = checkCompanyName(((await readJson(req)) as { name?: unknown }).name);
          await saveCompanies((await listCompanies()).map((c) => (c.code === company.code ? { ...c, name } : c)));
          await audit(me, 'company.rename', company.code, `${name} (was: ${company.name})`);
          await notify((await companyUsers(company.code)).map((u) => u.username), 'policy');
          return send(204);
        }
        if (method === 'GET' && m[2] === '/users') {
          const admins = await adminsOf(company.code);
          const users = (await companyUsers(company.code)).map((u) => ({
            username: u.username,
            name: u.display_name,
            active: isActive(u),
            admin: admins.includes(u.username),
            banned: u.banned === 1,
            moved: u.banned === MOVED,
          }));
          return send(200, { users });
        }
        // A new QR for someone in the company, e.g. its admin lost their phone and nobody else there can do it.
        if (method === 'POST' && m[2] === '/invite') {
          const username = String(((await readJson(req)) as { username?: unknown }).username ?? '');
          const user = await db.getUser(username);
          if (!user || companyOf(user.username) !== company.code) throw new HttpError(404, 'user not found');
          if (user.banned) throw new HttpError(400, `${shortId(user.username)} is suspended or was moved`);
          const invite = await newInvite(user.username);
          await audit(me, 'user.invite', user.username, 'new QR invite (super admin)');
          return send(200, { ...invite, ...(await inviteExtras(req, invite)) });
        }
      }
      if (method === 'POST' && path === '/v1/super/transfer') {
        // Move a person to another company. Their account here is kept as it is (groups, departments, catalog),
        // just closed; if they ever come back, that same account opens again with everything still attached.
        const body = (await readJson(req)) as { username?: unknown; to?: unknown; id?: unknown };
        const user = typeof body.username === 'string' ? await db.getUser(body.username) : undefined;
        if (!user || user.banned === MOVED) throw new HttpError(404, 'user not found');
        const to = checkCompanyCode(body.to);
        const toCompany = await getCompany(to);
        if (!toCompany) throw new HttpError(404, 'company not found');
        if (toCompany.status === 'pending') throw new HttpError(400, 'That company is still waiting for approval');
        if (to === companyOf(user.username)) throw new HttpError(400, 'They are already in that company');
        const id = body.id === undefined || body.id === '' ? shortId(user.username) : String(body.id);
        if (!ID_RE.test(id)) throw new HttpError(400, 'ID must be 3-32 characters: a-z, 0-9, _ or .');
        const target = makeUsername(id, to);
        const before = await db.getUser(target);
        if (before && before.banned !== MOVED) {
          throw new HttpError(409, `The ID "${id}" is already used in ${to}. Choose another ID.`);
        }
        if (before) {
          // Coming back: open their old account there again. Its old device sign-in is not valid any more.
          await db.clearDevice(target);
          await db.setBanned(target, false);
        } else {
          await db.createPendingUser(target, await hashPassword(randomBytes(24).toString('base64url')), {
            name: user.display_name,
            phone: user.phone,
            email: user.email,
          });
          const photo = await db.getAvatar(user.username);
          if (photo) await db.setAvatar(target, photo);
        }
        // The device is NOT signed out: the app keeps its chats and keys, and carries them to the new account.
        await db.setBanned(user.username, MOVED);
        await db.setInvite(user.username, null);
        await kick(user.username, 4006, 'moved to another company');
        await notifyGroupsOf(user.username);
        const invite = await newInvite(target);
        await audit(me, 'user.transfer', user.username, `to ${target}${before ? ' (back to their old account)' : ''}`);
        return send(200, { username: target, invite, returning: !!before, ...(await inviteExtras(req, invite)) });
      }
      throw new HttpError(404, 'not found');
    }

    // ---- admin: employee accounts (of the admin's own company) ----
    if (path.startsWith('/v1/admin/')) {
      if (!(await isAdminUser(me))) throw new HttpError(403, 'admin only');
      const co = companyOf(me);

      if (method === 'GET' && path === '/v1/admin/users') {
        const admins = await adminsOf(co);
        const owner = await ownerOf(co);
        const users: AdminUser[] = (await companyUsers(co)).map((u) => ({
          username: u.username,
          active: isActive(u),
          admin: admins.includes(u.username),
          ...(u.username === owner ? { owner: true } : {}),
          mustChangePassword: !!u.must_change,
          banned: u.banned === 1,
          ...(u.banned === MOVED ? { moved: true } : {}),
          online: isOnline(u),
          lastSeen: u.last_seen === null ? null : Number(u.last_seen),
          createdAt: Number(u.created_at),
          departments: u.departments,
          canShare: canShare(u),
          avatar: u.avatar_ver,
          phone: u.phone,
          email: u.email,
          name: u.display_name,
          birthday: u.birthday,
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
          birthday?: unknown;
        };
        // The admin types an ID; the account gets the company part (apps of the same version send just the ID).
        const raw = typeof body.username === 'string' ? normalizeId(body.username) : body.username;
        const typed = typeof raw === 'string' && co && raw.endsWith(`-${co}`) ? shortId(raw) : raw;
        if (typeof typed !== 'string' || !ID_RE.test(typed)) {
          throw new HttpError(400, ID_RULES);
        }
        const username = makeUsername(typed, co);
        // Normally there is no password: the person chooses one when they scan the QR invite.
        if (body.password !== undefined) checkNewPassword(body.password);
        const departments = await checkDepartments(co, body.departments);
        const { phone, email } = checkContactInfo(body.phone, body.email);
        const name = checkName(body.name);
        const birthday = checkBirthday(body.birthday);
        const photo = body.photo === undefined ? null : checkPhoto(body.photo);
        if (body.canShare !== undefined && typeof body.canShare !== 'boolean') {
          throw new HttpError(400, 'canShare must be true or false');
        }
        const canShare = body.canShare === true;
        if (await db.getUser(username)) throw new HttpError(409, 'That ID already exists');
        const password = typeof body.password === 'string' ? body.password : randomBytes(24).toString('base64url');
        await db.createPendingUser(username, await hashPassword(password), { departments, canShare, phone, email, name, birthday });
        if (photo) await db.setAvatar(username, { ...photo, ver: Date.now() });
        const invite = await newInvite(username);
        const detail = [name, departments.length && `departments: ${departments.join(', ')}`, phone && `mobile ${phone}`, email && `email ${email}`, birthday && `born ${birthday}`];
        await audit(me, 'user.create', username, detail.filter(Boolean).join(', '));
        return send(200, { ok: true, invite });
      }
      if ((m = path.match(/^\/v1\/admin\/users\/([^/]+)(\/password|\/ban|\/departments|\/share|\/contact|\/invite|\/profile|\/avatar|\/admin)?$/))) {
        const target = await colleague(me, userSeg(m[1]!));
        if (!target) throw new HttpError(404, 'user not found');
        if (target.banned === MOVED && m[2] && method !== 'GET') {
          throw new HttpError(400, `${shortId(target.username)} was moved to another company`);
        }
        // Only the main admin may change themselves this way; other admins can't remove them or demote them.
        const owner = await ownerOf(co);
        if (owner && target.username === owner && me !== owner && ((method === 'PUT' && m[2] === '/admin') || (method === 'DELETE' && !m[2]))) {
          throw new HttpError(403, 'Only the main admin can change the main admin’s account');
        }
        // Make someone an admin of the company, or take it away. A company always keeps at least one admin.
        if (method === 'PUT' && m[2] === '/admin') {
          const body = (await readJson(req)) as { admin?: unknown };
          if (typeof body.admin !== 'boolean') throw new HttpError(400, 'admin must be true or false');
          if (!co) throw new HttpError(400, 'Admins of this server are set in its settings (ADMIN_USERS)');
          const admins = await adminsOf(co);
          if (body.admin) {
            if (target.banned) throw new HttpError(400, `${shortId(target.username)} is suspended`);
            await setAdmins(co, [...admins, target.username]);
          } else {
            const rest = admins.filter((a) => a !== target.username);
            if (!rest.length) throw new HttpError(400, 'The company needs at least one admin');
            await setAdmins(co, rest);
          }
          await audit(me, body.admin ? 'user.admin_on' : 'user.admin_off', target.username);
          await notify((await companyUsers(co)).map((u) => u.username), 'policy'); // apps re-read who the admins are
          return send(204);
        }
        // A new QR invite (also to move someone to a new phone: joining replaces their old device).
        if (method === 'POST' && m[2] === '/invite') {
          const invite = await newInvite(target.username);
          await audit(me, 'user.invite', target.username, 'new QR invite');
          return send(200, invite);
        }
        if (method === 'PUT' && m[2] === '/profile') {
          const body = (await readJson(req)) as { name?: unknown; phone?: unknown; email?: unknown; birthday?: unknown };
          const name = body.name === undefined ? target.display_name : checkName(body.name);
          const birthday = body.birthday === undefined ? target.birthday : checkBirthday(body.birthday);
          const { phone, email } = checkContactInfo(body.phone ?? target.phone, body.email ?? target.email);
          await db.setDisplayName(target.username, name);
          await db.setContactInfo(target.username, phone, email);
          await db.setBirthday(target.username, birthday);
          await audit(me, 'user.profile', target.username, [name, phone, email, birthday && `born ${birthday}`].filter(Boolean).join(', ') || 'cleared');
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
          const departments = await checkDepartments(co, body.departments);
          await db.setDepartments(target.username, departments);
          await audit(me, 'user.department', target.username, departments.join(', ') || 'none');
          await notify([target.username], 'policy'); // department rights may differ
          return send(204);
        }
        if (method === 'POST' && m[2] === '/password') {
          const body = (await readJson(req)) as { password?: unknown };
          checkNewPassword(body.password);
          await db.setPassword(target.username, await hashPassword(body.password as string), true);
          await audit(me, 'user.reset_password', target.username);
          return send(204);
        }
        if (method === 'POST' && m[2] === '/ban') {
          const body = (await readJson(req)) as { banned?: unknown };
          if (typeof body.banned !== 'boolean') throw new HttpError(400, 'banned must be true or false');
          if (target.username === me) throw new HttpError(400, "You can't ban yourself");
          if (await isAdminUser(target.username)) throw new HttpError(400, "Admins can't be banned");
          await db.setBanned(target.username, body.banned);
          if (body.banned) {
            // Blocking signs them out for good: their device is cut off (its app deletes its keys), their password
            // stops working and any QR invite is cancelled. Unblocking alone doesn't let them back in; the admin
            // gives them a new QR code.
            await db.clearDevice(target.username);
            await db.setPassword(target.username, await hashPassword(randomBytes(24).toString('base64url')), true);
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
          const admins = await adminsOf(co);
          if (co && admins.includes(target.username)) {
            if (admins.length === 1) throw new HttpError(400, 'The company needs at least one admin');
            await setAdmins(co, admins.filter((a) => a !== target.username));
          }
          await db.deleteUser(target.username);
          await kick(target.username, 4001, 'account removed by admin');
          await audit(me, 'user.delete', target.username);
          if (groups.length) await notify([...new Set(groups.flatMap((g) => g.members))], 'groups');
          return send(204);
        }
      }

      // ---- departments: the list admins pick from when they add or move a user ----
      if (path === '/v1/admin/departments') {
        if (method === 'GET') return send(200, { departments: await getDepartments(co) });
        if (method === 'POST') {
          const name = checkDepartmentName(((await readJson(req)) as { name?: unknown }).name);
          const list = await getDepartments(co);
          if (list.some((d) => sameName(d, name))) throw new HttpError(409, `"${name}" already exists`);
          if (list.length >= MAX_DEPARTMENTS) throw new HttpError(400, `Up to ${MAX_DEPARTMENTS} departments`);
          await saveDepartments(co, [...list, name]);
          await audit(me, 'department.create', name);
          return send(200, { departments: await getDepartments(co) });
        }
      }
      if ((m = path.match(/^\/v1\/admin\/departments\/([^/]+)$/))) {
        let current: string;
        try {
          current = decodeURIComponent(m[1]!);
        } catch {
          throw new HttpError(400, 'bad department name');
        }
        const list = await getDepartments(co);
        const found = list.find((d) => sameName(d, current));
        if (!found) throw new HttpError(404, 'department not found');
        if (method === 'PUT') {
          const name = checkDepartmentName(((await readJson(req)) as { name?: unknown }).name);
          if (list.some((d) => d !== found && sameName(d, name))) throw new HttpError(409, `"${name}" already exists`);
          await replaceDepartment(co, found, name);
          await saveDepartments(co, list.map((d) => (d === found ? name : d)));
          await saveRules(co, (await getRules(co)).map((r) => (r.scope === 'department' && r.target === found ? { ...r, target: name } : r)));
          await audit(me, 'department.rename', name, `was: ${found}`);
          return send(200, { departments: await getDepartments(co) });
        }
        if (method === 'DELETE') {
          await replaceDepartment(co, found, null); // its people are kept, just not in this department
          await saveDepartments(co, list.filter((d) => d !== found));
          await saveRules(co, (await getRules(co)).filter((r) => !(r.scope === 'department' && r.target === found)));
          await notify((await companyUsers(co)).map((u) => u.username), 'policy');
          await audit(me, 'department.delete', found);
          return send(200, { departments: await getDepartments(co) });
        }
      }

      if (method === 'GET' && path === '/v1/admin/stats') {
        const users = (await companyUsers(co)).filter((u) => u.banned !== MOVED);
        const admins = await adminsOf(co);
        const stats: AdminStats = {
          users: users.length,
          active: users.filter(isActive).length,
          pending: users.filter((u) => !isActive(u)).length,
          banned: users.filter((u) => u.banned).length,
          online: users.filter(isOnline).length,
          admins: users.filter((u) => admins.includes(u.username)).length,
          groups: (await companyGroups(co)).length,
        };
        return send(200, stats);
      }
      if (method === 'GET' && path === '/v1/admin/audit') {
        // Pages, newest first: ?limit=50&before=<id of the last entry seen>. Each company sees what its own people did.
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || PAGE_SIZE));
        const before = Number(url.searchParams.get('before')) || undefined;
        const entries: AuditEntry[] = await db.listAudit({ limit, before, company: co });
        const page: Page<AuditEntry> & { entries: AuditEntry[] } = {
          items: entries,
          entries, // older apps read this
          next: entries.length === limit ? entries[entries.length - 1]!.id : null,
        };
        return send(200, page);
      }
      // Reports from people about others in this company: the admins look at them and close them.
      if (method === 'GET' && path === '/v1/admin/reports') {
        return send(200, { reports: JSON.parse((await db.getMeta(metaKey('reports', co))) ?? '[]') as Report[] });
      }
      if (method === 'POST' && (m = path.match(/^\/v1\/admin\/reports\/([0-9a-f]{16})\/close$/))) {
        const note = ((await readJson(req)) as { note?: unknown }).note;
        const list = JSON.parse((await db.getMeta(metaKey('reports', co))) ?? '[]') as Report[];
        const r = list.find((x) => x.id === m![1]);
        if (!r) throw new HttpError(404, 'report not found');
        Object.assign(r, { status: 'closed', closedBy: me, closedAt: Date.now(), ...(typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 500) } : {}) });
        await db.setMeta(metaKey('reports', co), JSON.stringify(list));
        await audit(me, 'report.close', r.user, r.reason);
        return send(200, r);
      }
      if (method === 'PUT' && path === '/v1/admin/communities') {
        const raw = ((await readJson(req)) as { communities?: unknown }).communities;
        if (!Array.isArray(raw) || raw.length > MAX_COMMUNITIES) throw new HttpError(400, `Up to ${MAX_COMMUNITIES} communities`);
        const known = new Set((await companyGroups(co)).map((g) => g.id));
        const list: Community[] = raw.map((c) => {
          const x = (c ?? {}) as Record<string, unknown>;
          const name = checkGroupName(x.name);
          const description = typeof x.description === 'string' ? x.description.trim().slice(0, 300) : '';
          const groups = Array.isArray(x.groups) ? [...new Set(x.groups.filter((g): g is string => typeof g === 'string' && known.has(g)))] : [];
          const id = typeof x.id === 'string' && /^[0-9a-f]{16}$/.test(x.id) ? x.id : randomBytes(8).toString('hex');
          return { id, name, description, groups };
        });
        await db.setMeta(metaKey('communities', co), JSON.stringify(list));
        await audit(me, 'community.update', 'communities', list.map((c) => c.name).join(', ') || 'none');
        await notify((await companyUsers(co)).map((u) => u.username), 'groups');
        return send(200, { communities: list });
      }      if (method === 'PUT' && path === '/v1/admin/helpdesk') {
        const contacts = checkHelpContacts(((await readJson(req)) as { contacts?: unknown }).contacts, co);
        await db.setMeta(metaKey('helpdesk', co), JSON.stringify(contacts));
        await audit(me, 'helpdesk.update', 'help desk', `${contacts.length} contacts`);
        return send(200, { contacts });
      }
      if (path === '/v1/admin/settings') {
        if (method === 'GET') return send(200, await getPolicy(co));
        if (method === 'PUT') {
          const body = (await readJson(req)) as Partial<Policy>;
          // Send just the switches you change; the others keep their value.
          const keys = ['allowEditDelete', 'allowClearHistory'] as const;
          const given = keys.filter((k) => body[k] !== undefined);
          if (!given.length) throw new HttpError(400, 'nothing to change');
          for (const k of given) if (typeof body[k] !== 'boolean') throw new HttpError(400, `${k} must be true or false`);
          const policy: Policy = { ...(await getPolicy(co)) };
          for (const k of given) policy[k] = body[k] as boolean;
          await db.setMeta(metaKey('policy', co), JSON.stringify(policy));
          // The same switches are the company rules of the rights system.
          const feature = { allowEditDelete: 'editDelete', allowClearHistory: 'clearHistory' } as const;
          const rules = (await getRules(co)).filter((r) => !(r.scope === 'company' && given.some((k) => feature[k] === r.feature)));
          for (const k of given) rules.push({ feature: feature[k], scope: 'company', target: '', member: '', allow: policy[k], setBy: me, setAt: Date.now() });
          await saveRules(co, rules);
          const label = { allowEditDelete: 'edit/delete messages', allowClearHistory: 'clear chat history' };
          const detail = given.map((k) => `${label[k]}: ${policy[k] ? 'on' : 'off'}`).join(', ');
          await audit(me, 'settings.update', 'policy', detail);
          await notify((await companyUsers(co)).map((u) => u.username), 'policy');
          return send(200, policy);
        }
      }

      // ---- groups: only admins create them and decide who is in them ----
      if (method === 'GET' && path === '/v1/admin/groups') {
        const cache = await infoCache(co);
        return send(200, { groups: await Promise.all((await companyGroups(co)).map((g) => infoOf(g, cache))) });
      }
      if (method === 'POST' && path === '/v1/admin/groups') {
        const body = (await readJson(req)) as { name?: unknown; members?: unknown; senders?: unknown; admins?: unknown; kind?: unknown };
        const name = checkGroupName(body.name);
        const members = await existingMembers(checkMemberList(body.members ?? []), co);
        const admins = checkGroupAdmins(body.admins, members);
        const channel = body.kind === 'channel';
        // A channel: only its admins post.
        const senders = channel ? admins : checkSenders(body.senders, members);
        const id = randomBytes(8).toString('hex');
        await db.createGroup({ id, name, createdBy: me, members, senders, admins });
        if (channel) await db.setMeta(metaKey('channels', co), JSON.stringify([...(await channelIds(co)), id]));
        const who = senders ? `; only these can send: ${senders.join(', ') || 'admins'}` : '';
        await audit(me, 'group.create', name, `members: ${members.join(', ') || 'none'}${who}`);
        await notify(members, 'groups');
        return send(200, await infoOf((await db.getGroup(id))!));
      }
      if ((m = path.match(/^\/v1\/admin\/groups\/([0-9a-f]+)$/)) && GROUP_ID_RE.test(m[1]!)) {
        const group = await db.getGroup(m[1]!);
        if (!group || companyOf(group.created_by) !== co) throw new HttpError(404, 'group not found');
        if (method === 'PUT') return send(200, await updateGroupFrom(me, group, await readJson(req)));
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
      if ((await adminsOf(companyOf(me))).length) throw new HttpError(403, 'Only an admin can delete accounts. Ask your admin.');
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
        // Browsers (web app) get Web Push, the iPhone app Apple's push, Android Firebase.
        const sender = user.push_token.startsWith(WEB_PUSH_PREFIX)
          ? (await webPush).sender
          : user.push_token.startsWith(APNS_PREFIX)
            ? apns
            : push;
        if (!sender) return;
        if ((await sender.send(user.push_token, kind)) === 'invalid') await db.setPushToken(to, null);
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
                ? [
                    (e as Error).message === MOVED_MESSAGE ? 'moved' : (e as Error).message === PENDING_MESSAGE ? 'pending' : 'banned',
                    (e as Error).message,
                  ]
                : status === 429
                  ? ['rate', 'Too many attempts, retrying later']
                  : ['unavailable', 'Server busy, reconnecting'];
          frame(ws, { type: 'error', code, message });
          return ws.close(4003, 'auth failed');
        }
        clearTimeout(authTimer);
        const preKeyCount = await db.countOneTimePreKeys(me);
        const meRow = (await db.getUser(me))!;
        frame(ws, {
          type: 'ready',
          preKeyCount,
          isAdmin: await isAdminUser(me),
          admins: await adminsOf(companyOf(me)),
          policy: await getPolicy(companyOf(me)),
          canShare: canShare(meRow),
          avatar: meRow.avatar_ver,
          rights: await rightsOf(meRow),
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
          const target = typeof f.to === 'string' && USERNAME_RE.test(f.to) ? await colleague(me, f.to) : undefined;
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
