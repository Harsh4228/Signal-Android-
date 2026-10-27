import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { MemoryStorage, MessengerClient } from '@meetme/core';
import { FcmSender } from '../src/push';
import { startTestServer } from './harness';

// A fake Google: the OAuth token endpoint and the FCM send endpoint, so the real FcmSender runs end to end.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const received: { token: string; message: Record<string, unknown>; raw: string }[] = [];
let tokenRequests = 0;
let invalidTokens = new Set<string>();

const google = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/token') {
      tokenRequests++;
      const jwt = new URLSearchParams(body).get('assertion')!;
      const [h, c, sig] = jwt.split('.');
      const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig!, 'base64url'));
      const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
      if (!ok || claims.scope !== 'https://www.googleapis.com/auth/firebase.messaging') {
        res.writeHead(401).end('bad jwt');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }));
      return;
    }
    if (req.url === '/v1/projects/meetme-test/messages:send' && req.headers.authorization === 'Bearer at-1') {
      const { message } = JSON.parse(body);
      if (invalidTokens.has(message.token)) {
        res.writeHead(404).end('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}');
        return;
      }
      received.push({ token: message.token, message, raw: body });
      res.writeHead(200).end('{}');
      return;
    }
    res.writeHead(404).end();
  });
});

let srv: Awaited<ReturnType<typeof startTestServer>>;
const clients: MessengerClient[] = [];

before(async () => {
  await new Promise<void>((r) => google.listen(0, '127.0.0.1', r));
  const g = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
  const push = new FcmSender(
    {
      project_id: 'meetme-test',
      client_email: 'push@meetme-test.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: `${g}/token`,
    },
    { fcmBaseUrl: g },
  );
  srv = await startTestServer(
    { stunUrls: [], turnUrls: [], trustProxy: false, adminUsers: [], openRegistration: true, pushDelayMs: 150 },
    { push },
  );
});
after(async () => {
  clients.forEach((c) => c.dispose());
  await new Promise((r) => setTimeout(r, 100));
  await srv.close();
  google.close();
});

async function waitFor(fn: () => boolean, what: string, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newClient(name: string, storage = new MemoryStorage()) {
  const c = new MessengerClient(storage);
  clients.push(c);
  if (!(await c.init())) await c.register(srv.url, name);
  c.connect();
  await waitFor(() => c.status === 'online', `${name} online`);
  return c;
}

test('offline recipients get a content-free push; online ones and receipts do not', async () => {
  const alice = await newClient('alice');
  const bobStorage = new MemoryStorage();
  let bob = await newClient('bob', bobStorage);
  const BOB_TOKEN = 'bob-device-token-0123456789abcdef';
  await bob.setPushToken(BOB_TOKEN);

  // Online: delivered over the socket, no push.
  await alice.addContact('bob');
  await alice.sendText('bob', 'are you there');
  await waitFor(() => bob.getMessages('alice').some((m) => m.text === 'are you there'), 'online delivery');
  await sleep(400);
  assert.equal(received.length, 0, 'no push while online');

  // Offline: exactly one push, and it carries nothing but "New message".
  bob.dispose();
  await sleep(100);
  await alice.sendText('bob', 'SECRET-PLANS for tomorrow');
  await waitFor(() => received.length === 1, 'push sent');
  const p = received[0]!;
  assert.equal(p.token, BOB_TOKEN);
  assert.ok(!p.raw.includes('SECRET'), 'no message text');
  assert.ok(!p.raw.includes('alice'), 'no sender');
  assert.deepEqual(p.message.data, { t: 'message' });
  assert.equal(tokenRequests, 1);

  // A second message within 20 s does not buzz again.
  await alice.sendText('bob', 'second');
  await sleep(400);
  assert.equal(received.length, 1, 'message pushes are throttled');

  // Bob comes back: everything queued arrives.
  bob = await newClient('bob', bobStorage);
  await waitFor(() => bob.getMessages('alice').some((m) => m.text === 'second'), 'queued delivery');

  // Incoming call while offline: high-priority call push (not throttled).
  bob.dispose();
  await sleep(100);
  await alice.sendCallSignal('bob', { k: 'call', callId: 'c1', action: 'offer', video: false, sdp: 'v=0' });
  await waitFor(() => received.length === 2, 'call push');
  assert.deepEqual(received[1]!.message.data, { t: 'call' });
  assert.ok(!received[1]!.raw.includes('v=0'));

  // ICE candidates and hangups never push.
  await alice.sendCallSignal('bob', { k: 'call', callId: 'c1', action: 'hangup' });
  await sleep(400);
  assert.equal(received.length, 2);

  // Token no longer valid (app reinstalled): the server forgets it and stops trying.
  invalidTokens = new Set([BOB_TOKEN]);
  await alice.sendCallSignal('bob', { k: 'call', callId: 'c2', action: 'offer', video: false, sdp: 'v=0' });
  await sleep(600);
  invalidTokens = new Set();
  await alice.sendCallSignal('bob', { k: 'call', callId: 'c3', action: 'offer', video: false, sdp: 'v=0' });
  await sleep(600);
  assert.equal(received.length, 2, 'invalid token was dropped');
});

test('apps with their own call screen get silent call pushes; messages still show a notification', async () => {
  const caller = await newClient('carol');
  const dana = await newClient('dana');
  const TOKEN = 'dana-device-token-0123456789abcdef';
  await dana.setPushToken(TOKEN, { callUi: true });
  await caller.addContact('dana');
  dana.dispose();
  await sleep(100);
  const before = received.length;

  // Call: data only, so the app wakes up and shows Answer / Decline itself.
  await caller.sendCallSignal('dana', { k: 'call', callId: 'd1', action: 'offer', video: true, sdp: 'v=0' });
  await waitFor(() => received.length === before + 1, 'call push');
  const call = received.at(-1)!;
  assert.equal(call.token, TOKEN, 'the real token goes to Google, without the marker');
  assert.deepEqual(call.message.data, { t: 'call' });
  const android = call.message.android as Record<string, unknown>;
  assert.equal(android.priority, 'HIGH');
  assert.equal(android.notification, undefined);

  // Message: the usual "New message" notification.
  await caller.sendText('dana', 'hello');
  await waitFor(() => received.length === before + 2, 'message push');
  assert.equal(((received.at(-1)!.message.android as Record<string, unknown>).notification as { body: string }).body, 'New message');
});
