import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { createMeetMeServer } from '../src/app';
import { openPostgres } from '../src/postgres';

// Two MeetMe servers sharing one PostgreSQL database (like two containers behind a load balancer).
// Runs only when TEST_DATABASE_URL is set.
const pgUrl = process.env.TEST_DATABASE_URL;

async function waitFor(fn: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('two server instances: messages and forced logouts cross between them', { skip: !pgUrl }, async () => {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: pgUrl });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  const u = new URL(pgUrl!);
  u.searchParams.set('options', `-c search_path=${schema}`);

  const cfg = { dbPath: 'unused', stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: true };
  const servers = [];
  const urls: string[] = [];
  for (let i = 0; i < 2; i++) {
    const s = createMeetMeServer({ ...cfg, attachmentsDir: `${process.cwd()}/.tmp-att-${schema}` }, await openPostgres(u.toString()));
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    servers.push(s);
    urls.push(`http://127.0.0.1:${(s.address() as AddressInfo).port}`);
  }

  const clients: MessengerClient[] = [];
  const connect = async (name: string, url: string, storage = new MemoryStorage()) => {
    const c = new MessengerClient(storage);
    clients.push(c);
    if (!(await c.init())) await c.register(url, name);
    c.connect();
    await waitFor(() => c.status === 'online', `${name} online`);
    return c;
  };
  const texts = (c: MessengerClient, peer: string) => c.getMessages(peer).filter((m) => !m.system).map((m) => m.text);

  try {
    const alice = await connect('alice', urls[0]!);
    const bob = await connect('bob', urls[1]!);

    await alice.addContact('bob');
    await alice.sendText('bob', 'hello from server one');
    await waitFor(() => texts(bob, 'alice').includes('hello from server one'), 'cross-instance delivery');
    await bob.sendText('alice', 'hi from server two');
    await waitFor(() => texts(alice, 'bob').includes('hi from server two'), 'reply across instances');
    for (let i = 0; i < 20; i++) await alice.sendText('bob', `n${i}`);
    await waitFor(() => texts(bob, 'alice').includes('n19'), 'burst delivered');
    assert.deepEqual(
      texts(bob, 'alice').filter((t) => t.startsWith('n')),
      Array.from({ length: 20 }, (_, i) => `n${i}`),
      'order is kept across instances',
    );

    // Deleting the account on server one disconnects the socket held by server two.
    const carol = await connect('carol', urls[1]!);
    const carolClosed = new Promise<void>((r) => carol.on('change', () => carol.status === 'offline' && r()));
    const fetchImpl = (carol as unknown as { account: { username: string; password: string } }).account;
    const res = await fetch(`${urls[0]}/v1/account`, {
      method: 'DELETE',
      headers: { authorization: 'Basic ' + Buffer.from(`carol:${fetchImpl.password}`).toString('base64') },
    });
    assert.equal(res.status, 204);
    await Promise.race([carolClosed, new Promise((_, j) => setTimeout(() => j(new Error('carol not kicked')), 5000))]);
  } finally {
    clients.forEach((c) => c.dispose());
    await new Promise((r) => setTimeout(r, 100));
    for (const s of servers) {
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
    await new Promise((r) => setTimeout(r, 100));
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    const { rmSync } = await import('node:fs');
    rmSync(`${process.cwd()}/.tmp-att-${schema}`, { recursive: true, force: true });
  }
});
