import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createMeetMeServer, type ServerConfig } from '../src/app';
import { openPostgres } from '../src/postgres';
import type { PushSender } from '../src/push';

/**
 * Starts a test server on a random port. Uses SQLite by default; set TEST_DATABASE_URL to run the
 * same tests against PostgreSQL (each test file gets its own throw-away schema).
 */
export async function startTestServer(cfg: Omit<ServerConfig, 'dbPath'>, extra: { push?: PushSender; port?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'meetme-'));
  const pgUrl = process.env.TEST_DATABASE_URL;
  let schema = '';
  let connectionString = '';
  let deps: Parameters<typeof createMeetMeServer>[1] = {};

  if (pgUrl) {
    schema = `test_${randomBytes(6).toString('hex')}`;
    const admin = new pg.Client({ connectionString: pgUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const u = new URL(pgUrl);
    u.searchParams.set('options', `-c search_path=${schema}`);
    connectionString = u.toString();
    deps = await openPostgres(connectionString);
  }

  const server = createMeetMeServer({ ...cfg, dbPath: join(dir, 'test.db'), attachmentsDir: join(dir, 'attachments') }, { ...deps, push: extra.push });
  await new Promise<void>((r) => server.listen(extra.port ?? 0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url,
    dir,
    backend: pgUrl ? 'postgres' : 'sqlite',
    /** Every stored envelope (sender + body), read straight from the database. */
    async queueRows(): Promise<{ sender: string; body: string }[]> {
      if (pgUrl) {
        const c = new pg.Client({ connectionString });
        await c.connect();
        const rows = (await c.query('SELECT sender, body FROM queue ORDER BY id')).rows as { sender: string; body: string }[];
        await c.end();
        return rows;
      }
      const { DatabaseSync } = await import('node:sqlite');
      const raw = new DatabaseSync(join(dir, 'test.db'));
      const rows = raw.prepare('SELECT sender, body FROM queue ORDER BY id').all() as { sender: string; body: string }[];
      raw.close();
      return rows;
    },
    /** Every stored envelope body, read straight from the database. */
    async queueBodies(): Promise<string[]> {
      if (pgUrl) {
        const c = new pg.Client({ connectionString });
        await c.connect();
        const rows = (await c.query('SELECT body FROM queue')).rows as { body: string }[];
        await c.end();
        return rows.map((r) => r.body);
      }
      const { DatabaseSync } = await import('node:sqlite');
      const raw = new DatabaseSync(join(dir, 'test.db'));
      const rows = raw.prepare('SELECT body FROM queue').all() as { body: string }[];
      raw.close();
      return rows.map((r) => r.body);
    },
    async close() {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await new Promise((r) => setTimeout(r, 50));
      if (pgUrl) {
        const admin = new pg.Client({ connectionString: pgUrl });
        await admin.connect();
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
        await admin.end();
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
