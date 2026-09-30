import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryKeyHash,
  generateIdentityKeyPair,
  isSealed,
  issueCertificate,
  newDeliveryKey,
  sealMessage,
  toBase64,
  unsealMessage,
  verifyCertificate,
} from '../src/index';

const server = generateIdentityKeyPair();
const alice = generateIdentityKeyPair();
const bob = generateIdentityKeyPair();
const mallory = generateIdentityKeyPair();

test('sealed sender: recipient learns the sender, the blob reveals nothing', () => {
  const cert = issueCertificate(server, 'alice', toBase64(alice.pub));
  assert.ok(verifyCertificate(server.pub, cert));
  const sealed = sealMessage(alice, cert, bob.pub, '{"inner":"ratchet message"}');
  assert.ok(isSealed(sealed));
  assert.ok(!sealed.includes('alice'), 'username not visible');
  assert.ok(!sealed.includes(toBase64(alice.pub)), 'identity key not visible');

  const out = unsealMessage(bob, sealed);
  assert.equal(out.cert.u, 'alice');
  assert.equal(out.body, '{"inner":"ratchet message"}');
  assert.deepEqual(out.senderIdentityKey, alice.pub);

  // Only bob can open it.
  assert.throws(() => unsealMessage(mallory, sealed));
});

test('sealed sender: forged, expired or stolen certificates are rejected', () => {
  const now = Date.now();
  const cert = issueCertificate(server, 'alice', toBase64(alice.pub), now);
  assert.equal(verifyCertificate(server.pub, { ...cert, u: 'boss' }, now), false, 'changed name');
  assert.equal(verifyCertificate(mallory.pub, cert, now), false, 'wrong server key');
  assert.equal(verifyCertificate(server.pub, cert, cert.exp + 1), false, 'expired');

  // Mallory has seen Alice's certificate but does not hold Alice's key: sealing with it fails on open.
  const stolen = sealMessage(mallory, cert, bob.pub, 'pretending to be alice');
  assert.throws(() => unsealMessage(bob, stolen), /does not match/);

  // Tampering with any layer is detected.
  const sealed = JSON.parse(sealMessage(alice, cert, bob.pub, 'hi'));
  for (const field of ['e', 's', 'c']) {
    const bad = { ...sealed };
    const bytes = Buffer.from(bad[field], 'base64');
    bytes[3]! ^= 1;
    bad[field] = bytes.toString('base64');
    assert.throws(() => unsealMessage(bob, JSON.stringify(bad)), `tampered ${field}`);
  }
});

test('delivery keys: random, and only the hash is shared with the server', () => {
  const k1 = newDeliveryKey();
  const k2 = newDeliveryKey();
  assert.notEqual(k1, k2);
  assert.notEqual(deliveryKeyHash(k1), k1);
  assert.equal(deliveryKeyHash(k1), deliveryKeyHash(k1));
});
