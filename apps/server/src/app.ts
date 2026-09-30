import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, promises as fs } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  MAX_ATTACHMENT_BYTES,
  MIN_PASSWORD_LENGTH,
  USERNAME_RE,
  type AdminUser,
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
import { isActive, openSqlite, type Db } from './db';
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

function checkNewPassword(pw: unknown, old?: string) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH || pw.length > 128) {
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (old !== undefined && pw === old) throw new HttpError(400, 'Choose a password different from the old one');
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
    authCache.set(username, { digest, until: Date.now() + 10 * 60_000 });
    return username;
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

  async function readJson(req: http.IncomingMessage): Promise<unknown> {
    const text = await readBody(req, MAX_BODY);
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
      if (typeof key === 'string' && target?.access_key_hash && isActive(target)) {
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
    if (method === 'GET' && (m = path.match(/^\/v1\/users\/([a-z0-9_.]{3,32})$/))) {
      const u = await db.getUser(m[1]!);
      if (!u) throw new HttpError(404, 'user not found');
      return send(200, { exists: true, active: isActive(u) });
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
      const me_: MeResponse = { username: me, isAdmin: config.adminUsers.includes(me), admins: config.adminUsers };
      return send(200, me_);
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
        }));
        return send(200, { users });
      }
      if (method === 'POST' && path === '/v1/admin/users') {
        const body = (await readJson(req)) as { username?: unknown; password?: unknown };
        if (typeof body.username !== 'string' || !USERNAME_RE.test(body.username)) {
          throw new HttpError(400, 'ID must be 3-32 characters: a-z, 0-9, _ or .');
        }
        checkNewPassword(body.password);
        if (await db.getUser(body.username)) throw new HttpError(409, 'That ID already exists');
        await db.createPendingUser(body.username, hashPassword(body.password as string));
        return send(200, { ok: true });
      }
      if ((m = path.match(/^\/v1\/admin\/users\/([a-z0-9_.]{3,32})(\/password)?$/))) {
        const target = await db.getUser(m[1]!);
        if (!target) throw new HttpError(404, 'user not found');
        if (method === 'POST' && m[2]) {
          const body = (await readJson(req)) as { password?: unknown };
          checkNewPassword(body.password);
          await db.setPassword(target.username, hashPassword(body.password as string), true);
          return send(204);
        }
        if (method === 'DELETE' && !m[2]) {
          if (target.username === me) throw new HttpError(400, "You can't remove yourself");
          await db.deleteUser(target.username);
          await kick(target.username, 4001, 'account removed by admin');
          return send(204);
        }
      }
    }
    if (method === 'DELETE' && path === '/v1/account') {
      await db.deleteUser(me);
      await kick(me, 4001, 'account deleted');
      return send(204);
    }
    throw new HttpError(404, 'not found');
  }

  const server = http.createServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
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
    const heartbeat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
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
          // 'rate' is temporary; 'auth' means this device's secret is no longer valid (logged in elsewhere / removed).
          const rate = e instanceof HttpError && e.status === 429;
          frame(ws, {
            type: 'error',
            code: rate ? 'rate' : 'auth',
            message: rate ? 'Too many attempts, retrying later' : 'Authentication failed',
          });
          return ws.close(4003, 'auth failed');
        }
        clearTimeout(authTimer);
        const preKeyCount = await db.countOneTimePreKeys(me);
        frame(ws, { type: 'ready', preKeyCount, isAdmin: config.adminUsers.includes(me), admins: config.adminUsers });
        // Queued envelopes first, THEN register as online (new messages are delivered directly from then
        // on), then check the queue once more for anything that arrived in between. deliver() skips repeats.
        await deliverPending(me, ws);
        online.get(me)?.close(4004, 'connected elsewhere');
        online.set(me, ws);
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
      if (me && online.get(me) === ws) online.delete(me);
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
    clearInterval(purge);
    pushTimers.forEach(clearTimeout);
    wss.close();
    void db.close();
  });

  return server;
}
