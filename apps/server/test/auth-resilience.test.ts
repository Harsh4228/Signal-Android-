import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { createMeetMeServer } from '../src/app';
import { openSqlite, type Db } from '../src/db';

// A server that can't check a login right now (database busy, restarting) must not sign the app out:
// signing out deletes the device's keys. Only a real "wrong / replaced login" may do that.

async function waitFor(fn: () => boolean, what: string, ms = 8000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const config = { stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: true };

test('a server error while checking the login keeps the app signed in; it reconnects when the server recovers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'meetme-'));
  const dbPath = join(dir, 'test.db');
  const attachmentsDir = join(dir, 'attachments');
  const first = createMeetMeServer({ ...config, dbPath, attachmentsDir });
  await new Promise<void>((r) => first.listen(0, '127.0.0.1', r));
  const port = (first.address() as AddressInfo).port;

  const c = new MessengerClient(new MemoryStorage());
  await c.init();
  await c.register(`http://127.0.0.1:${port}`, 'zed');
  c.connect();
  await waitFor(() => c.status === 'online', 'online');

  // "Restart" onto a server whose database fails every login check (fresh process: nothing cached).
  const closed = new Promise((r) => first.close(r));
  c.disconnect();
  await waitFor(() => c.status === 'offline', 'offline');
  await closed;
  const real = openSqlite(dbPath);
  let failing = true;
  let failures = 0;
  const flaky = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'getUser' && failing) {
        return async () => {
          failures++;
          throw new Error('database is locked');
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Db;
  const second = createMeetMeServer({ ...config, dbPath, attachmentsDir }, { db: flaky });
  await new Promise<void>((r) => second.listen(port, '127.0.0.1', r));
  c.connect();

  try {
    await waitFor(() => failures >= 2, 'the app tried to log in while the database was failing');
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(c.account, 'still signed in');
    assert.equal(c.account!.username, 'zed');

    failing = false;
    await waitFor(() => c.status === 'online', 'back online', 40_000);
  } finally {
    const done = new Promise((r) => second.close(r));
    c.dispose();
    second.closeAllConnections();
    await done;
    await new Promise((r) => setTimeout(r, 50));
    rmSync(dir, { recursive: true, force: true });
  }
});
