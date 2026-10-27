import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, MessengerClient, inviteCode, resolveRight, type RightRule } from '@meetme/core';
import { startTestServer } from './harness';

// Rights: admins decide who may use each protected function, for the company, a department, a group or a person;
// group admins decide inside their own group.
let srv: Awaited<ReturnType<typeof startTestServer>>;
let url = '';
const clients: MessengerClient[] = [];

before(async () => {
  srv = await startTestServer({ stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: ['admin'], openRegistration: false });
  url = srv.url;
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

async function device() {
  const c = new MessengerClient(new MemoryStorage());
  clients.push(c);
  await c.init();
  return c;
}

async function online(c: MessengerClient) {
  c.connect();
  await waitFor(() => c.status === 'online', 'online');
  return c;
}

const rule = (r: Partial<RightRule>): RightRule => ({
  feature: 'download',
  scope: 'company',
  target: '',
  member: '',
  allow: true,
  setBy: '',
  setAt: 0,
  ...r,
});

test('the most specific rule wins', () => {
  const who = { username: 'ravi', departments: ['Sales'] };
  assert.equal(resolveRight([], 'download', who), false); // default: nobody downloads
  assert.equal(resolveRight([], 'forward', who), true);
  const rules = [
    rule({ scope: 'company', allow: false }),
    rule({ scope: 'department', target: 'Sales', allow: true }),
  ];
  assert.equal(resolveRight(rules, 'download', who), true); // department beats company
  assert.equal(resolveRight(rules, 'download', { username: 'x', departments: [] }), false);
  rules.push(rule({ scope: 'user', target: 'ravi', allow: false }));
  assert.equal(resolveRight(rules, 'download', who), false); // the person beats the department
  rules.push(rule({ scope: 'group', target: 'g1', member: 'ravi', allow: true }));
  assert.equal(resolveRight(rules, 'download', who, 'g1'), true); // ...but in group g1 they may
  assert.equal(resolveRight(rules, 'download', who, 'g2'), false);
});

test('admins set rights; people get them at once; group admins manage their own group', async () => {
  const admin = await device();
  await admin.register(url, 'admin');
  await online(admin);
  await waitFor(() => admin.isAdmin, 'admin flag');
  await admin.addDepartment('Sales');

  const join = async (username: string, departments: string[]) => {
    const invite = await admin.inviteEmployee({ username, name: username, departments });
    const c = await device();
    await c.join(inviteCode(url, invite), `${username}-password`);
    return online(c);
  };
  const ravi = await join('ravi', ['Sales']);
  const meena = await join('meena', []);
  const kiran = await join('kiran', []);

  // Nobody may download by default; the admin always may.
  assert.equal(ravi.can('download'), false);
  assert.equal(admin.can('download'), true);

  // The Sales department may download: Ravi gets it straight away, Meena not.
  await admin.setRight({ feature: 'download', scope: 'department', target: 'Sales', allow: true });
  await waitFor(() => ravi.can('download'), 'ravi may download');
  assert.equal(meena.can('download'), false);

  // A group with Meena as its group admin.
  const g = await admin.createGroup('Project', ['ravi', 'meena', 'kiran']);
  await admin.updateGroup(g.id, { admins: ['meena'] });
  await waitFor(() => meena.isGroupAdmin(`#${g.id}`), 'meena is group admin');
  assert.equal(kiran.isGroupAdmin(`#${g.id}`), false);

  // Meena lets Kiran download inside the group only.
  await meena.setRight({ feature: 'download', scope: 'group', target: g.id, member: 'kiran', allow: true });
  await waitFor(() => kiran.can('download', `#${g.id}`), 'kiran may download in the group');
  assert.equal(kiran.can('download'), false);
  assert.equal(kiran.can('download', 'ravi'), false);

  // Group admins can't change company or department rights, and nobody else can change the group's.
  await assert.rejects(meena.setRight({ feature: 'download', scope: 'company', target: '', allow: true }), /company admins/);
  await assert.rejects(kiran.setRight({ feature: 'download', scope: 'group', target: g.id, allow: true }), /not found/);

  // Group admins can add people to their group (only from the company).
  await meena.updateMyGroup(g.id, { members: ['ravi', 'meena', 'kiran', 'admin'] });
  assert.ok((await admin.listAllGroups()).find((x) => x.id === g.id)!.members.includes('admin'));

  // Blocking forward for one person; everyone else keeps it.
  await admin.setRight({ feature: 'forward', scope: 'user', target: 'ravi', allow: false });
  await waitFor(() => !ravi.can('forward'), 'ravi may not forward');
  assert.equal(meena.can('forward'), true);
  // ... and taking the rule away gives it back.
  await admin.setRight({ feature: 'forward', scope: 'user', target: 'ravi', allow: null });
  await waitFor(() => ravi.can('forward'), 'ravi may forward again');

  // The old company switch and the company rule are the same thing.
  await admin.setPolicy({ allowEditDelete: true });
  await waitFor(() => kiran.can('editDelete'), 'edit/delete allowed');
  const rules = await admin.getRightRules();
  assert.ok(rules.some((r) => r.feature === 'editDelete' && r.scope === 'company' && r.allow));

  // Everything shows in the activity log, page by page.
  const first = await admin.getAuditPage(null, 2);
  assert.equal(first.items.length, 2);
  assert.ok(first.next);
  const second = await admin.getAuditPage(first.next, 2);
  assert.ok(second.items.every((e) => e.id < first.items[1]!.id));
});

test('help desk: the admin keeps a list of contacts, everyone can read it', async () => {
  const admin = clients.find((c) => c.account?.username === 'admin')!;
  const ravi = clients.find((c) => c.account?.username === 'ravi')!;
  await admin.setHelpDesk([
    { title: 'IT support', name: 'Sunil', department: '', phone: '+91 98765 43210', email: 'it@example.com', hours: 'Mon-Fri 9-6', username: 'admin' },
  ]);
  const list = await ravi.getHelpDesk();
  assert.equal(list.length, 1);
  assert.equal(list[0]!.title, 'IT support');
  await assert.rejects(ravi.setHelpDesk([]), /admin only/);
  await assert.rejects(admin.setHelpDesk([{ title: '', name: '', department: '', phone: '', email: '', hours: '', username: '' }]), /title/);
});
