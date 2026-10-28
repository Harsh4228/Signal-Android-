import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Bus, BusEvent } from './bus';
import {
  bannedValue,
  companyOfActor,
  companyPattern,
  parseDepartments,
  parseSenders,
  toProduct,
  type AuditRow,
  type AvatarRow,
  type BackupRow,
  type Db,
  type Envelope,
  type GroupRow,
  type Opk,
  type ProductPhoto,
  type ProductRow,
  type RawUser,
  type UserRow,
} from './db';

/**
 * PostgreSQL backend. Same data as the SQLite backend (usernames, password hashes, PUBLIC keys and
 * ciphertext envelopes), so the server still knows nothing about message content.
 *
 * Several MeetMe server instances can share one database: they tell each other about new envelopes
 * and forced logouts with LISTEN / NOTIFY (see PgBus), so no Redis is needed.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    username      TEXT PRIMARY KEY,
    pass_hash     TEXT NOT NULL,
    device_hash   TEXT,
    must_change   SMALLINT NOT NULL DEFAULT 0,
    identity_key  TEXT NOT NULL,
    spk_id        INTEGER NOT NULL,
    spk_pub       TEXT NOT NULL,
    spk_sig       TEXT NOT NULL,
    created_at    BIGINT NOT NULL
  );
  ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS access_key_hash TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS banned SMALLINT NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS online_at BIGINT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen BIGINT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'departments') THEN
      ALTER TABLE users ADD COLUMN departments TEXT NOT NULL DEFAULT '[]';
      UPDATE users SET departments = json_build_array(department)::text WHERE department IS NOT NULL AND department <> '';
    END IF;
  END $$;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS can_share SMALLINT NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_ver BIGINT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_hash TEXT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires BIGINT;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_last_seen SMALLINT NOT NULL DEFAULT 0;
  CREATE TABLE IF NOT EXISTS avatars (
    username TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
    mime     TEXT NOT NULL,
    data     TEXT NOT NULL,
    ver      BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS chat_groups (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );
  ALTER TABLE chat_groups ADD COLUMN IF NOT EXISTS senders TEXT;
  ALTER TABLE chat_groups ADD COLUMN IF NOT EXISTS admins TEXT;
  CREATE TABLE IF NOT EXISTS chat_group_members (
    group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
    username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    PRIMARY KEY (group_id, username)
  );
  CREATE INDEX IF NOT EXISTS chat_group_members_user ON chat_group_members(username);
  CREATE TABLE IF NOT EXISTS products (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    price       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    photo_ver   BIGINT,
    updated_at  BIGINT NOT NULL
  );
  ALTER TABLE products ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT '';
  CREATE INDEX IF NOT EXISTS products_owner ON products(owner);
  CREATE TABLE IF NOT EXISTS product_photos (
    id   TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id     BIGSERIAL PRIMARY KEY,
    ts     BIGINT NOT NULL,
    actor  TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT NOT NULL
  );
  -- Each audit entry knows its company (indexed, for paging). Older rows get it from the actor (runs once: then
  -- every row with a company part has it).
  ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS company TEXT NOT NULL DEFAULT '';
  UPDATE audit_log SET company = regexp_replace(actor, '^.*-', '') WHERE company = '' AND actor LIKE '%-%';
  CREATE INDEX IF NOT EXISTS audit_log_company ON audit_log(company, id);
  CREATE TABLE IF NOT EXISTS backup_ops (
    id       BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    data     TEXT NOT NULL,
    ts       BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS backup_ops_user ON backup_ops(username, id);
  CREATE TABLE IF NOT EXISTS backups (
    username   TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS one_time_prekeys (
    username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    id       INTEGER NOT NULL,
    pub      TEXT NOT NULL,
    PRIMARY KEY (username, id)
  );
  CREATE TABLE IF NOT EXISTS queue (
    id        BIGSERIAL PRIMARY KEY,
    recipient TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    sender    TEXT NOT NULL,
    body      TEXT NOT NULL,
    ts        BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS queue_recipient ON queue(recipient, id);
  CREATE INDEX IF NOT EXISTS queue_ts ON queue(ts);
`;

// BIGINT columns arrive as strings from node-postgres.
const toUser = (r: RawUser): UserRow => ({
  ...r,
  departments: parseDepartments(r.departments),
  created_at: Number(r.created_at),
  online_at: r.online_at === null ? null : Number(r.online_at),
  last_seen: r.last_seen === null ? null : Number(r.last_seen),
  avatar_ver: r.avatar_ver === null || r.avatar_ver === undefined ? null : Number(r.avatar_ver),
});

// One query per list: members are aggregated in SQL.
const GROUP_SELECT = `
  SELECT g.id, g.name, g.created_by, g.created_at, g.senders, g.admins,
         COALESCE(ARRAY_AGG(m.username ORDER BY m.username) FILTER (WHERE m.username IS NOT NULL), '{}') AS members
  FROM chat_groups g LEFT JOIN chat_group_members m ON m.group_id = g.id`;
type RawGroup = Omit<GroupRow, 'senders' | 'admins'> & { senders: string | null; admins: string | null };
const toGroup = (r: RawGroup): GroupRow => ({
  ...r,
  created_at: Number(r.created_at),
  members: r.members ?? [],
  senders: parseSenders(r.senders),
  admins: parseSenders(r.admins) ?? [],
});

const toEnvelope = (r: { id: string | number; sender: string; body: string; ts: string | number }): Envelope => ({
  id: Number(r.id),
  sender: r.sender,
  body: r.body,
  ts: Number(r.ts),
});

export async function openPostgres(connectionString: string): Promise<{ db: Db; bus: Bus }> {
  const pool = new pg.Pool({ connectionString, max: Number(process.env.PG_POOL_SIZE ?? 10) });
  pool.on('error', (e) => console.error('postgres pool error', e.message));

  // Serialise schema creation when several instances start at once.
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(424242)');
    await c.query(SCHEMA);
  } finally {
    await c.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    c.release();
  }

  async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(client);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async function insertOpks(c: pg.PoolClient | pg.Pool, username: string, opks: Opk[]) {
    if (!opks.length) return;
    await c.query(
      `INSERT INTO one_time_prekeys (username, id, pub)
       SELECT $1, * FROM UNNEST($2::int[], $3::text[])
       ON CONFLICT (username, id) DO UPDATE SET pub = EXCLUDED.pub`,
      [username, opks.map((k) => k.id), opks.map((k) => k.pub)],
    );
  }

  // Users deleted meanwhile are skipped instead of failing the whole change.
  async function setMembers(c: pg.PoolClient, id: string, members: string[]) {
    await c.query('DELETE FROM chat_group_members WHERE group_id = $1', [id]);
    await c.query(
      `INSERT INTO chat_group_members (group_id, username)
       SELECT $1, username FROM users WHERE username = ANY($2::text[]) ON CONFLICT DO NOTHING`,
      [id, members],
    );
  }

  const one = async <T>(sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0] as T | undefined;

  const db: Db = {
    getUser: async (username) => {
      const r = await one<RawUser>('SELECT * FROM users WHERE username = $1', [username]);
      return r && toUser(r);
    },
    listUsers: async () => ((await pool.query('SELECT * FROM users ORDER BY username')).rows as RawUser[]).map(toUser),
    companyUsers: async (company) =>
      (
        (
          company
            ? await pool.query('SELECT * FROM users WHERE username LIKE $1 ORDER BY username', [companyPattern(company)])
            : await pool.query("SELECT * FROM users WHERE username NOT LIKE '%-%' ORDER BY username")
        ).rows as RawUser[]
      ).map(toUser),
    createUser: (u, opks) =>
      tx(async (c) => {
        await c.query(
          `INSERT INTO users (username, pass_hash, device_hash, must_change, identity_key, spk_id, spk_pub, spk_sig, created_at)
           VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8)`,
          [u.username, u.passHash ?? u.deviceHash, u.deviceHash, u.identityKey, u.spk.id, u.spk.pub, u.spk.sig, Date.now()],
        );
        await insertOpks(c, u.username, opks);
      }),
    async createPendingUser(username, passHash, { departments = [], canShare = false, phone = '', email = '', name = '' } = {}) {
      await pool.query(
        `INSERT INTO users (username, pass_hash, device_hash, must_change, identity_key, spk_id, spk_pub, spk_sig, created_at, departments, can_share, phone, email, display_name)
         VALUES ($1, $2, NULL, 1, '', 0, '', '', $3, $4, $5, $6, $7, $8)`,
        [username, passHash, Date.now(), JSON.stringify(departments), canShare ? 1 : 0, phone, email, name],
      );
    },
    async setDisplayName(username, name) {
      await pool.query('UPDATE users SET display_name = $1 WHERE username = $2', [name, username]);
    },
    async setPrivacy(username, p) {
      if (p.about !== undefined) await pool.query('UPDATE users SET about = $1 WHERE username = $2', [p.about, username]);
      if (p.hideLastSeen !== undefined) {
        await pool.query('UPDATE users SET hide_last_seen = $1 WHERE username = $2', [p.hideLastSeen ? 1 : 0, username]);
      }
    },
    async setInvite(username, invite) {
      await pool.query('UPDATE users SET invite_hash = $1, invite_expires = $2 WHERE username = $3', [
        invite?.hash ?? null,
        invite?.expires ?? null,
        username,
      ]);
    },
    async setContactInfo(username, phone, email) {
      await pool.query('UPDATE users SET phone = $1, email = $2 WHERE username = $3', [phone, email, username]);
    },
    activate: (username, a, opks) =>
      tx(async (c) => {
        await c.query(
          'UPDATE users SET device_hash = $1, identity_key = $2, spk_id = $3, spk_pub = $4, spk_sig = $5, push_token = NULL, access_key_hash = NULL WHERE username = $6',
          [a.deviceHash, a.identityKey, a.spk.id, a.spk.pub, a.spk.sig, username],
        );
        await c.query('DELETE FROM one_time_prekeys WHERE username = $1', [username]);
        await insertOpks(c, username, opks);
        await c.query('DELETE FROM queue WHERE recipient = $1', [username]);
      }),
    async setPassword(username, passHash, mustChange) {
      await pool.query('UPDATE users SET pass_hash = $1, must_change = $2 WHERE username = $3', [
        passHash,
        mustChange ? 1 : 0,
        username,
      ]);
    },
    async setPushToken(username, token) {
      await pool.query('UPDATE users SET push_token = $1 WHERE username = $2', [token, username]);
    },
    async setAccessKeyHash(username, hash) {
      await pool.query('UPDATE users SET access_key_hash = $1 WHERE username = $2', [hash, username]);
    },
    async getOrCreateMeta(key, create) {
      // ON CONFLICT DO NOTHING: when several instances start together, the first value wins for all.
      await pool.query('INSERT INTO meta (k, v) VALUES ($1, $2) ON CONFLICT (k) DO NOTHING', [key, create()]);
      return (await one<{ v: string }>('SELECT v FROM meta WHERE k = $1', [key]))!.v;
    },
    async deleteUser(username) {
      await tx(async (c) => {
        await c.query('DELETE FROM products WHERE owner = $1', [username]); // their catalog goes with them
        await c.query('DELETE FROM users WHERE username = $1', [username]);
      });
    },
    async setSignedPreKey(username, spk) {
      await pool.query('UPDATE users SET spk_id = $1, spk_pub = $2, spk_sig = $3 WHERE username = $4', [
        spk.id,
        spk.pub,
        spk.sig,
        username,
      ]);
    },
    addOneTimePreKeys: (username, opks) => insertOpks(pool, username, opks),
    // SKIP LOCKED: two people fetching the same user's keys at once never get the same prekey.
    takeOneTimePreKey: (username) =>
      one<Opk>(
        `DELETE FROM one_time_prekeys WHERE (username, id) = (
           SELECT username, id FROM one_time_prekeys WHERE username = $1 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
         ) RETURNING id, pub`,
        [username],
      ),
    countOneTimePreKeys: async (username) =>
      Number((await one<{ n: string }>('SELECT COUNT(*) AS n FROM one_time_prekeys WHERE username = $1', [username]))!.n),
    enqueue: async (recipient, sender, body, ts) =>
      Number(
        (await one<{ id: string }>('INSERT INTO queue (recipient, sender, body, ts) VALUES ($1, $2, $3, $4) RETURNING id', [
          recipient,
          sender,
          body,
          ts,
        ]))!.id,
      ),
    pending: async (recipient) =>
      (
        await pool.query('SELECT id, sender, body, ts FROM queue WHERE recipient = $1 ORDER BY id LIMIT 500', [recipient])
      ).rows.map(toEnvelope),
    envelope: async (id, recipient) => {
      const r = await one<Parameters<typeof toEnvelope>[0]>(
        'SELECT id, sender, body, ts FROM queue WHERE id = $1 AND recipient = $2',
        [id, recipient],
      );
      return r && toEnvelope(r);
    },
    async ack(id, recipient) {
      await pool.query('DELETE FROM queue WHERE id = $1 AND recipient = $2', [id, recipient]);
    },
    queueSize: async (recipient) =>
      Number((await one<{ n: string }>('SELECT COUNT(*) AS n FROM queue WHERE recipient = $1', [recipient]))!.n),
    async purgeOlderThan(ts) {
      await pool.query('DELETE FROM queue WHERE ts < $1', [ts]);
    },
    async setBanned(username, banned) {
      await pool.query('UPDATE users SET banned = $1 WHERE username = $2', [bannedValue(banned), username]);
    },
    async clearDevice(username) {
      await pool.query('UPDATE users SET device_hash = NULL, push_token = NULL, access_key_hash = NULL WHERE username = $1', [username]);
    },
    async setDepartments(username, departments) {
      await pool.query('UPDATE users SET departments = $1 WHERE username = $2', [JSON.stringify(departments), username]);
    },
    async setCanShare(username, canShare) {
      await pool.query('UPDATE users SET can_share = $1 WHERE username = $2', [canShare ? 1 : 0, username]);
    },
    setAvatar: (username, avatar) =>
      tx(async (c) => {
        if (avatar) {
          await c.query(
            `INSERT INTO avatars (username, mime, data, ver) VALUES ($1, $2, $3, $4)
             ON CONFLICT (username) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, ver = EXCLUDED.ver`,
            [username, avatar.mime, avatar.data, avatar.ver],
          );
        } else {
          await c.query('DELETE FROM avatars WHERE username = $1', [username]);
        }
        await c.query('UPDATE users SET avatar_ver = $1 WHERE username = $2', [avatar?.ver ?? null, username]);
      }),
    async getAvatar(username) {
      const r = await one<AvatarRow>('SELECT mime, data, ver FROM avatars WHERE username = $1', [username]);
      return r && { ...r, ver: Number(r.ver) };
    },
    async setPresence(username, onlineAt, lastSeen) {
      await pool.query('UPDATE users SET online_at = $1, last_seen = $2 WHERE username = $3', [onlineAt, lastSeen, username]);
    },
    getMeta: async (key) => (await one<{ v: string }>('SELECT v FROM meta WHERE k = $1', [key]))?.v,
    async setMeta(key, value) {
      await pool.query('INSERT INTO meta (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v', [key, value]);
    },
    listGroups: async () =>
      ((await pool.query(`${GROUP_SELECT} GROUP BY g.id ORDER BY LOWER(g.name)`)).rows as RawGroup[]).map(toGroup),
    groupsOf: async (username) =>
      (
        (
          await pool.query(
            `${GROUP_SELECT} WHERE g.id IN (SELECT group_id FROM chat_group_members WHERE username = $1)
             GROUP BY g.id ORDER BY LOWER(g.name)`,
            [username],
          )
        ).rows as RawGroup[]
      ).map(toGroup),
    getGroup: async (id) => {
      const r = await one<RawGroup>(`${GROUP_SELECT} WHERE g.id = $1 GROUP BY g.id`, [id]);
      return r && toGroup(r);
    },
    createGroup: (g) =>
      tx(async (c) => {
        await c.query('INSERT INTO chat_groups (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)', [
          g.id,
          g.name,
          g.createdBy,
          Date.now(),
        ]);
        await setMembers(c, g.id, g.members);
        await c.query('UPDATE chat_groups SET senders = $1 WHERE id = $2', [g.senders && JSON.stringify(g.senders), g.id]);
        if (g.admins?.length) await c.query('UPDATE chat_groups SET admins = $1 WHERE id = $2', [JSON.stringify(g.admins), g.id]);
      }),
    updateGroup: (id, changes) =>
      tx(async (c) => {
        if (changes.name !== undefined) await c.query('UPDATE chat_groups SET name = $1 WHERE id = $2', [changes.name, id]);
        if (changes.members) await setMembers(c, id, changes.members);
        if (changes.senders !== undefined) {
          await c.query('UPDATE chat_groups SET senders = $1 WHERE id = $2', [changes.senders && JSON.stringify(changes.senders), id]);
        }
        if (changes.admins !== undefined) {
          await c.query('UPDATE chat_groups SET admins = $1 WHERE id = $2', [JSON.stringify(changes.admins), id]);
        }
      }),
    async deleteGroup(id) {
      await pool.query('DELETE FROM chat_groups WHERE id = $1', [id]);
    },
    listProducts: async (owner) =>
      ((await pool.query('SELECT * FROM products WHERE owner = $1 ORDER BY lower(name)', [owner])).rows as ProductRow[]).map(toProduct),
    async adoptOrphanProducts(owner) {
      await pool.query("UPDATE products SET owner = $1 WHERE owner = ''", [owner]);
    },
    async getProduct(id) {
      const r = await one<ProductRow>('SELECT * FROM products WHERE id = $1', [id]);
      return r && toProduct(r);
    },
    async putProduct(p, photo) {
      await tx(async (c) => {
        await c.query(
          `INSERT INTO products (id, owner, name, price, description, updated_at) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price,
           description = EXCLUDED.description, updated_at = EXCLUDED.updated_at`,
          [p.id, p.owner, p.name, p.price, p.description, p.updated_at],
        );
        if (photo) {
          await c.query(
            'INSERT INTO product_photos (id, mime, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data',
            [p.id, photo.mime, photo.data],
          );
        } else if (photo === null) {
          await c.query('DELETE FROM product_photos WHERE id = $1', [p.id]);
        }
        if (photo !== undefined) await c.query('UPDATE products SET photo_ver = $1 WHERE id = $2', [photo?.ver ?? null, p.id]);
      });
    },
    async deleteProduct(id) {
      await pool.query('DELETE FROM products WHERE id = $1', [id]);
    },
    getProductPhoto: (id) => one<ProductPhoto>('SELECT mime, data FROM product_photos WHERE id = $1', [id]),
    async addAudit(e) {
      await pool.query('INSERT INTO audit_log (ts, actor, action, target, detail, company) VALUES ($1, $2, $3, $4, $5, $6)', [
        e.ts,
        e.actor,
        e.action,
        e.target,
        e.detail,
        companyOfActor(e.actor),
      ]);
    },
    listAudit: async ({ limit, before, company }) =>
      (
        (
          await pool.query(
            'SELECT id, ts, actor, action, target, detail FROM audit_log WHERE company = $1 AND id < $2 ORDER BY id DESC LIMIT $3',
            [company, before ?? Number.MAX_SAFE_INTEGER, limit],
          )
        ).rows as AuditRow[]
      ).map((r) => ({ ...r, id: Number(r.id), ts: Number(r.ts) })),
    async getBackup(username) {
      const r = await one<BackupRow>('SELECT data, updated_at FROM backups WHERE username = $1', [username]);
      return r && { data: r.data, updated_at: Number(r.updated_at) };
    },
    async putBackup(username, data) {
      await pool.query(
        `INSERT INTO backups (username, data, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (username) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
        [username, data, Date.now()],
      );
    },
    async deleteBackup(username) {
      await pool.query('DELETE FROM backups WHERE username = $1', [username]);
      await pool.query('DELETE FROM backup_ops WHERE username = $1', [username]);
    },
    addBackupOp: async (username, data) =>
      Number((await one<{ id: string }>('INSERT INTO backup_ops (username, data, ts) VALUES ($1, $2, $3) RETURNING id', [username, data, Date.now()]))!.id),
    listBackupOps: async (username, after, limit) =>
      (await pool.query('SELECT id, data FROM backup_ops WHERE username = $1 AND id > $2 ORDER BY id LIMIT $3', [username, after, limit])).rows.map(
        (r: { id: string; data: string }) => ({ id: Number(r.id), data: r.data }),
      ),
    countBackupOps: async (username) =>
      Number((await one<{ n: string }>('SELECT COUNT(*) AS n FROM backup_ops WHERE username = $1', [username]))!.n),
    async pruneBackupOps(username, upTo) {
      await pool.query('DELETE FROM backup_ops WHERE username = $1 AND id <= $2', [username, upTo]);
    },
    async close() {
      await bus.close();
      await pool.end();
    },
  };

  // NOTIFY channels are shared by the whole database, so name ours after the schema: two MeetMe
  // installations in different schemas of one database never see each other's events.
  const schemaName = String((await pool.query('SELECT current_schema() AS s')).rows[0]?.s ?? 'public');
  const channel = `meetme_${schemaName.replace(/[^a-z0-9_]/gi, '_')}`.slice(0, 63);
  const bus = await PgBus.create(connectionString, channel);
  return { db, bus };
}

/** Cross-instance events over Postgres LISTEN / NOTIFY. Payloads are tiny (never message content). */
class PgBus implements Bus {
  private readonly origin = randomUUID();
  private handler: (e: BusEvent) => void = () => {};
  private closed = false;

  private constructor(
    private listener: pg.Client,
    private readonly connectionString: string,
    private readonly publisher: pg.Pool,
    private readonly channel: string,
  ) {}

  static async create(connectionString: string, channel: string): Promise<PgBus> {
    const bus = new PgBus(new pg.Client({ connectionString }), connectionString, new pg.Pool({ connectionString, max: 2 }), channel);
    await bus.connect();
    return bus;
  }

  private async connect() {
    this.listener.on('notification', (n) => {
      try {
        const msg = JSON.parse(n.payload ?? '') as { o: string; e: BusEvent };
        if (msg.o !== this.origin) this.handler(msg.e);
      } catch {
        /* ignore malformed */
      }
    });
    // Reconnect the listener if the connection drops (e.g. database restart).
    this.listener.on('error', () => void this.reconnect());
    this.listener.on('end', () => void this.reconnect());
    await this.listener.connect();
    await this.listener.query(`LISTEN ${this.channel}`);
  }

  private async reconnect() {
    if (this.closed) return;
    this.listener.removeAllListeners();
    await this.listener.end().catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    if (this.closed) return;
    this.listener = new pg.Client({ connectionString: this.connectionString });
    await this.connect().catch(() => setTimeout(() => void this.reconnect(), 2000));
  }

  onEvent(fn: (e: BusEvent) => void) {
    this.handler = fn;
  }

  async publish(e: BusEvent) {
    await this.publisher.query('SELECT pg_notify($1, $2)', [this.channel, JSON.stringify({ o: this.origin, e })]);
  }

  async close() {
    this.closed = true;
    this.listener.removeAllListeners();
    await this.listener.end().catch(() => {});
    await this.publisher.end().catch(() => {});
  }
}
