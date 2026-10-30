import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { startTestServer } from './harness';

// App Store rules for chat apps: people can block others and report them to the admins, and ask for deletion.
let srv: Awaited<ReturnType<typeof startTestServer>>;
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['admin'], openRegistration: false });
});
after(async () => {
  clients.forEach((c) => c.dispose());
  await new Promise((r) => setTimeout(r, 100));
  await srv.close();
});

async function waitFor(fn: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function fresh() {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  return c;
}

async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
}

test('blocking drops their messages; reports and deletion requests reach the admin', async () => {
  const admin = await fresh();
  await admin.register(srv.url, 'admin');
  await online(admin);
  await admin.createEmployee('asha', 'temp-password-1');
  await admin.createEmployee('vik', 'temp-password-2');
  const asha = await fresh();
  await asha.login(srv.url, 'asha', 'temp-password-1', 'asha-secret-1');
  await online(asha);
  const vik = await fresh();
  await vik.login(srv.url, 'vik', 'temp-password-2', 'vik-secret-12');
  await online(vik);

  await vik.sendText('asha', 'hello before');
  await waitFor(() => asha.getMessages('vik').some((m) => m.text === 'hello before'), 'first message');

  await asha.setBlocked('vik', true);
  assert.ok(asha.isBlocked('vik'));
  await vik.sendText('asha', 'spam after block');
  await asha.sendText('admin', 'ping'); // something else that does arrive, to know delivery went on
  await new Promise((r) => setTimeout(r, 800));
  assert.ok(!asha.getMessages('vik').some((m) => m.text === 'spam after block'), 'blocked message dropped');

  await asha.report('vik', 'Spam', { details: 'keeps sending ads', includeMessages: true });
  await assert.rejects(asha.report('vik', 'Not a real reason'), /invalid reason/);
  await assert.rejects(asha.report('asha', 'Spam'), /invalid reason/);
  // The block list is kept on the server (a new phone gets it back).
  const again = await fresh();
  await again.login(srv.url, 'asha', 'asha-secret-1');
  await online(again);
  await waitFor(() => again.isBlocked('vik'), 'block list restored');

  await vik.requestAccountDeletion('leaving the company');

  const reports = await admin.getReports();
  assert.equal(reports.length, 2);
  const spam = reports.find((r) => r.reason === 'Spam')!;
  assert.equal(spam.by, 'asha');
  assert.equal(spam.user, 'vik');
  assert.ok(spam.messages.some((m) => m.text === 'hello before' && m.from === 'vik'));
  assert.ok(reports.some((r) => r.user === 'vik' && r.by === 'vik' && r.reason === 'Delete my account'));

  const closed = await admin.closeReport(spam.id, 'warned him');
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closedBy, 'admin');
  await assert.rejects(again.getReports(), /admin only/);

  await again.setBlocked('vik', false);
  assert.ok(!again.isBlocked('vik'));
});

test('the privacy policy, terms and support pages are public', async () => {
  for (const [path, text] of [['/privacy', 'Privacy Policy'], ['/terms', 'objectionable content'], ['/support', 'CellMate Support']] as const) {
    const res = await fetch(`${srv.url}${path}`);
    assert.equal(res.status, 200, path);
    const body = await res.text();
    assert.match(body, new RegExp(text));
    assert.doesNotMatch(body, /\{\{support\}\}/);
  }
});
