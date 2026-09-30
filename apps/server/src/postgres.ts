import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Bus, BusEvent } from './bus';
import type { Db, Envelope, Opk, UserRow } from './db';

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

  const one = async <T>(sql: string, params: unknown[]) => (await pool.query(sql, params)).rows[0] as T | undefined;

  const db: Db = {
    getUser: (username) => one<UserRow>('SELECT * FROM users WHERE username = $1', [username]),
    listUsers: async () => (await pool.query('SELECT * FROM users ORDER BY username')).rows as UserRow[],
    createUser: (u, opks) =>
      tx(async (c) => {
        await c.query(
          `INSERT INTO users (username, pass_hash, device_hash, must_change, identity_key, spk_id, spk_pub, spk_sig, created_at)
           VALUES ($1, $2, $2, 0, $3, $4, $5, $6, $7)`,
          [u.username, u.deviceHash, u.identityKey, u.spk.id, u.spk.pub, u.spk.sig, Date.now()],
        );
        await insertOpks(c, u.username, opks);
      }),
    async createPendingUser(username, passHash) {
      await pool.query(
        `INSERT INTO users (username, pass_hash, device_hash, must_change, identity_key, spk_id, spk_pub, spk_sig, created_at)
         VALUES ($1, $2, NULL, 1, '', 0, '', '', $3)`,
        [username, passHash, Date.now()],
      );
    },
    activate: (username, a, opks) =>
      tx(async (c) => {
        await c.query(
          'UPDATE users SET device_hash = $1, identity_key = $2, spk_id = $3, spk_pub = $4, spk_sig = $5 WHERE username = $6',
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
    async deleteUser(username) {
      await pool.query('DELETE FROM users WHERE username = $1', [username]);
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
