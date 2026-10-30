import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { APNS_PREFIX, ApnsSender, parseAppleToken } from '../src/apns';

// A fake Apple push service (HTTP/2 without TLS), so the real ApnsSender runs end to end.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const received: { path: string; headers: http2.IncomingHttpHeaders; body: any }[] = [];
const gone = new Set<string>();

const apple = http2.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const jwt = String(req.headers.authorization ?? '').replace(/^bearer /, '');
    const [h, c, sig] = jwt.split('.');
    const ok = createVerify('SHA256').update(`${h}.${c}`).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig ?? '', 'base64url'));
    const head = JSON.parse(Buffer.from(h ?? '', 'base64url').toString() || '{}');
    const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString() || '{}');
    if (!ok || head.kid !== 'KEY123' || claims.iss !== 'TEAM123') {
      res.writeHead(403).end('{"reason":"InvalidProviderToken"}');
      return;
    }
    const token = req.url.split('/').pop()!;
    if (gone.has(token)) {
      res.writeHead(410).end('{"reason":"Unregistered"}');
      return;
    }
    received.push({ path: req.url, headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200).end();
  });
});

let sender: ApnsSender;
const alert = 'a'.repeat(64);
const voip = 'b'.repeat(64);
const stored = APNS_PREFIX + JSON.stringify({ e: 'p', a: alert, v: voip });

before(async () => {
  await new Promise<void>((r) => apple.listen(0, '127.0.0.1', r));
  sender = new ApnsSender(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'KEY123', 'TEAM123', 'com.example.app', {
    origin: `http://127.0.0.1:${(apple.address() as AddressInfo).port}`,
  });
});

after(() => {
  sender.close();
  apple.close();
});

test('Apple tokens are checked before they are stored', () => {
  assert.ok(parseAppleToken(stored));
  assert.equal(parseAppleToken(APNS_PREFIX + JSON.stringify({ e: 'p', a: '', v: '' })), null);
  assert.equal(parseAppleToken(APNS_PREFIX + JSON.stringify({ e: 'x', a: alert })), null);
  assert.equal(parseAppleToken(APNS_PREFIX + JSON.stringify({ e: 'p', a: 'not hex/../' })), null);
  assert.equal(parseAppleToken('webpush:{}'), null);
});

test('a message is a plain "New message" notification, a call rings through the VoIP token', async () => {
  assert.equal(await sender.send(stored, 'message'), 'ok');
  assert.equal(await sender.send(stored, 'call'), 'ok');
  const [msg, call] = received;
  assert.equal(msg!.path, `/3/device/${alert}`);
  assert.equal(msg!.headers['apns-topic'], 'com.example.app');
  assert.equal(msg!.headers['apns-push-type'], 'alert');
  assert.equal(msg!.body.aps.alert.body, 'New message');
  assert.equal(call!.path, `/3/device/${voip}`);
  assert.equal(call!.headers['apns-topic'], 'com.example.app.voip');
  assert.equal(call!.headers['apns-push-type'], 'voip');
  assert.deepEqual(call!.body, { aps: {}, t: 'call' });
  // Nothing about who or what.
  for (const r of received) assert.doesNotMatch(JSON.stringify(r.body), /alice|bob|hello/i);
});

test('a phone without notifications still rings for calls; an uninstalled app is forgotten', async () => {
  received.length = 0;
  const callsOnly = APNS_PREFIX + JSON.stringify({ e: 'p', a: '', v: voip });
  assert.equal(await sender.send(callsOnly, 'message'), 'ok');
  assert.equal(received.length, 0);
  gone.add(voip);
  assert.equal(await sender.send(callsOnly, 'call'), 'invalid');
});
