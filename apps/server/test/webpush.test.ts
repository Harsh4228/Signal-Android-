import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createDecipheriv, createECDH, createPublicKey, createVerify, hkdfSync, randomBytes } from 'node:crypto';
import { WEB_PUSH_PREFIX, WebPushSender, newVapidKeys } from '../src/webpush';

// Web Push for the web app: the push service gets a VAPID-signed request and a body only the browser can open.
test('web push: signed for the push service, encrypted for the browser (RFC 8291)', async () => {
  // The "browser": its key pair and auth secret, like PushSubscription.getKey().
  const browser = createECDH('prime256v1');
  const uaPublic = browser.generateKeys();
  const auth = randomBytes(16);

  let got: { headers: http.IncomingHttpHeaders; body: Buffer } | null = null;
  const service = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      got = { headers: req.headers, body: Buffer.concat(chunks) };
      res.writeHead(201).end();
    });
  });
  await new Promise<void>((r) => service.listen(0, '127.0.0.1', r));
  const port = (service.address() as { port: number }).port;

  const vapid = newVapidKeys();
  const sender = new WebPushSender(vapid, 'https://chat.example.com');
  // The sender only accepts https endpoints; for the test, swap the scheme just before fetching.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) => realFetch(url.replace('https://', 'http://'), init)) as typeof fetch;
  try {
    const token = WEB_PUSH_PREFIX + JSON.stringify({ e: `https://127.0.0.1:${port}/push/abc`, p: uaPublic.toString('base64url'), a: auth.toString('base64url') });
    assert.equal(await sender.send(token, 'call'), 'ok');
  } finally {
    globalThis.fetch = realFetch;
    service.close();
  }
  const { headers, body } = got!;
  assert.equal(headers['content-encoding'], 'aes128gcm');
  assert.equal(headers.ttl, '45');

  // VAPID: a JWT for this push service, signed with the server's key.
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(String(headers.authorization))!;
  assert.ok(m);
  const claims = JSON.parse(Buffer.from(m[2]!, 'base64url').toString()) as { aud: string; sub: string };
  assert.equal(claims.aud, `https://127.0.0.1:${port}`);
  assert.equal(m[4], vapid.publicKey);
  const raw = Buffer.from(vapid.publicKey, 'base64url');
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(createVerify('SHA256').update(`${m[1]}.${m[2]}`).verify({ key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3]!, 'base64url')));

  // Decrypt like a browser would.
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const secret = browser.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const ct = body.subarray(21 + idlen);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  assert.deepEqual(JSON.parse(plain.subarray(0, -1).toString()), { t: 'call' });
});
