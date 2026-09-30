import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  _decodeUtf8Manual,
  _encodeUtf8Manual,
  fromBase64,
  toBase64,
  utf8,
  fromUtf8,
  generateIdentityKeyPair,
  generateKeyPair,
  signPreKey,
  x3dhInitiate,
  x3dhRespond,
  initSender,
  initReceiver,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeState,
  deserializeState,
  bytesEqual,
  safetyNumber,
  MemoryStorage,
  ProtocolStore,
  SessionCipher,
  createAccount,
  type PreKeyBundle,
  type RatchetState,
} from '../src/index';

test('base64 round-trips all lengths', () => {
  for (let n = 0; n < 50; n++) {
    const b = crypto.getRandomValues(new Uint8Array(n));
    assert.ok(bytesEqual(fromBase64(toBase64(b)), b));
    assert.equal(toBase64(b), Buffer.from(b).toString('base64'));
  }
  assert.throws(() => fromBase64('ab$='));
});

test('manual UTF-8 decoder (React Native fallback) matches TextDecoder', () => {
  for (const s of ['hello', 'héllo wörld', 'नमस्ते दुनिया', '你好', '🔒🎥👍🏽', '']) {
    assert.equal(_decodeUtf8Manual(utf8(s)), s);
    assert.ok(bytesEqual(_encodeUtf8Manual(s), utf8(s)));
  }
  assert.throws(() => _decodeUtf8Manual(new Uint8Array([0xc3])));
  assert.throws(() => _decodeUtf8Manual(new Uint8Array([0xed, 0xa0, 0x80]))); // surrogate
});

function handshake(withOpk = true) {
  const alice = generateIdentityKeyPair();
  const bob = generateIdentityKeyPair();
  const spk = generateKeyPair();
  const opk = generateKeyPair();
  const bundle: PreKeyBundle = {
    identityKey: bob.pub,
    signedPreKey: { id: 1, pub: spk.pub, sig: signPreKey(bob, spk.pub) },
    oneTimePreKey: withOpk ? { id: 7, pub: opk.pub } : undefined,
  };
  const a = x3dhInitiate(alice, bundle);
  const b = x3dhRespond({
    ourIdentity: bob,
    ourSignedPreKey: spk,
    ourOneTimePreKey: withOpk ? opk : undefined,
    theirIdentityKey: alice.pub,
    theirEphemeralKey: a.ephemeralPub,
  });
  return { a, b, spk, bundle, alice, bob };
}

test('X3DH: both sides derive the same key (with and without one-time prekey)', () => {
  for (const withOpk of [true, false]) {
    const { a, b } = handshake(withOpk);
    assert.ok(bytesEqual(a.sharedKey, b.sharedKey));
    assert.ok(bytesEqual(a.associatedData, b.associatedData));
  }
});

test('X3DH: rejects a bundle with a forged signed-prekey signature', () => {
  const { bundle, alice } = handshake();
  const evil = generateKeyPair();
  assert.throws(() => x3dhInitiate(alice, { ...bundle, signedPreKey: { ...bundle.signedPreKey, pub: evil.pub } }));
});

function pair(): { A: RatchetState; B: RatchetState } {
  const { a, b, spk } = handshake();
  return { A: initSender(a.sharedKey, spk.pub, a.associatedData), B: initReceiver(b.sharedKey, spk, b.associatedData) };
}

function send(s: RatchetState, text: string) {
  const r = ratchetEncrypt(s, utf8(text));
  return { state: r.state, msg: { h: r.header, c: r.ciphertext } };
}

test('Double Ratchet: conversation back and forth', () => {
  let { A, B } = pair();
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 3; i++) {
      const s = send(A, `a${round}${i}`);
      A = s.state;
      const r = ratchetDecrypt(B, s.msg.h, s.msg.c);
      B = r.state;
      assert.equal(fromUtf8(r.plaintext), `a${round}${i}`);
    }
    const s = send(B, `b${round}`);
    B = s.state;
    const r = ratchetDecrypt(A, s.msg.h, s.msg.c);
    A = r.state;
    assert.equal(fromUtf8(r.plaintext), `b${round}`);
  }
});

test('Double Ratchet: out-of-order and lost messages', () => {
  let { A, B } = pair();
  const msgs = [];
  for (let i = 0; i < 6; i++) {
    const s = send(A, `m${i}`);
    A = s.state;
    msgs.push(s.msg);
  }
  for (const i of [5, 0, 3, 1]) {
    const r = ratchetDecrypt(B, msgs[i]!.h, msgs[i]!.c);
    B = r.state;
    assert.equal(fromUtf8(r.plaintext), `m${i}`);
  }
  // Bob replies, Alice ratchets, then the delayed m2 still decrypts.
  const s = send(B, 'reply');
  B = s.state;
  A = ratchetDecrypt(A, s.msg.h, s.msg.c).state;
  const late = ratchetDecrypt(B, msgs[2]!.h, msgs[2]!.c);
  assert.equal(fromUtf8(late.plaintext), 'm2');
});

test('Double Ratchet: tampering is detected and does not corrupt state', () => {
  let { A, B } = pair();
  const s = send(A, 'hello');
  A = s.state;
  const bad = s.msg.c.slice();
  bad[0]! ^= 1;
  assert.throws(() => ratchetDecrypt(B, s.msg.h, bad));
  const badHeader = s.msg.h.slice();
  badHeader[39]! ^= 1;
  assert.throws(() => ratchetDecrypt(B, badHeader, s.msg.c));
  // original B state still works
  assert.equal(fromUtf8(ratchetDecrypt(B, s.msg.h, s.msg.c).plaintext), 'hello');
});

test('Double Ratchet: replay of an already-decrypted message fails', () => {
  let { A, B } = pair();
  const s = send(A, 'once');
  A = s.state;
  B = ratchetDecrypt(B, s.msg.h, s.msg.c).state;
  assert.throws(() => ratchetDecrypt(B, s.msg.h, s.msg.c));
});

test('Double Ratchet: state survives serialization', () => {
  let { A, B } = pair();
  const s = send(A, 'x');
  A = deserializeState(JSON.parse(JSON.stringify(serializeState(s.state))));
  B = deserializeState(JSON.parse(JSON.stringify(serializeState(B))));
  const r = ratchetDecrypt(B, s.msg.h, s.msg.c);
  assert.equal(fromUtf8(r.plaintext), 'x');
  const s2 = send(A, 'y');
  assert.equal(fromUtf8(ratchetDecrypt(r.state, s2.msg.h, s2.msg.c).plaintext), 'y');
});

async function makeUser(name: string) {
  const store = new ProtocolStore(new MemoryStorage());
  const reg = await createAccount(store, 'http://x', name);
  const bundle = (opkIndex = 0): PreKeyBundle => ({
    identityKey: reg.account.identity.pub,
    signedPreKey: {
      id: reg.signedPreKey.id,
      pub: fromBase64(reg.signedPreKey.pub),
      sig: fromBase64(reg.signedPreKey.sig),
    },
    oneTimePreKey: {
      id: reg.oneTimePreKeys[opkIndex]!.id,
      pub: fromBase64(reg.oneTimePreKeys[opkIndex]!.pub),
    },
  });
  return { store, cipher: new SessionCipher(store), bundle, reg };
}

test('SessionCipher: prekey messages, replies, and replay protection', async () => {
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  assert.equal(await alice.cipher.initOutgoing('bob', bob.bundle()), 'new');

  const w1 = await alice.cipher.encrypt('bob', 'hi bob');
  const w2 = await alice.cipher.encrypt('bob', 'are you there?');
  assert.equal(w1.t, 'prekey');
  assert.equal(w2.t, 'prekey');

  assert.equal((await bob.cipher.decrypt('alice', w1)).plaintext, 'hi bob');
  assert.equal((await bob.cipher.decrypt('alice', w2)).plaintext, 'are you there?');
  await assert.rejects(bob.cipher.decrypt('alice', w1)); // replay

  const reply = await bob.cipher.encrypt('alice', 'hey alice');
  assert.equal(reply.t, 'msg');
  assert.equal((await alice.cipher.decrypt('bob', reply)).plaintext, 'hey alice');

  const w3 = await alice.cipher.encrypt('bob', 'now normal');
  assert.equal(w3.t, 'msg');
  assert.equal((await bob.cipher.decrypt('alice', w3)).plaintext, 'now normal');

  // one-time prekey was consumed
  const opks = await bob.store.getOneTimePreKeys();
  assert.equal(opks.keys.has(bob.reg.oneTimePreKeys[0]!.id), false);
});

test('SessionCipher: both sides start a session at the same time', async () => {
  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  await alice.cipher.initOutgoing('bob', bob.bundle(0));
  await bob.cipher.initOutgoing('alice', alice.bundle(0));
  const fromA = await alice.cipher.encrypt('bob', 'from a');
  const fromB = await bob.cipher.encrypt('alice', 'from b');
  assert.equal((await bob.cipher.decrypt('alice', fromA)).plaintext, 'from a');
  assert.equal((await alice.cipher.decrypt('bob', fromB)).plaintext, 'from b');
  // Conversation continues to work in both directions afterwards.
  for (let i = 0; i < 3; i++) {
    assert.equal((await bob.cipher.decrypt('alice', await alice.cipher.encrypt('bob', `a${i}`))).plaintext, `a${i}`);
    assert.equal((await alice.cipher.decrypt('bob', await bob.cipher.encrypt('alice', `b${i}`))).plaintext, `b${i}`);
  }
});

test('SessionCipher: detects identity key change', async () => {
  const alice = await makeUser('alice');
  const bob1 = await makeUser('bob');
  await alice.cipher.initOutgoing('bob', bob1.bundle());
  const bob2 = await makeUser('bob'); // bob reinstalled -> new identity
  assert.equal(await alice.cipher.initOutgoing('bob', bob2.bundle()), 'changed');
});

test('safety number is identical on both sides and changes with keys', () => {
  const a = generateIdentityKeyPair();
  const b = generateIdentityKeyPair();
  const n1 = safetyNumber('alice', a.pub, 'bob', b.pub);
  const n2 = safetyNumber('bob', b.pub, 'alice', a.pub);
  assert.equal(n1, n2);
  assert.match(n1, /^(\d{5} ){11}\d{5}$/);
  assert.notEqual(n1, safetyNumber('alice', a.pub, 'bob', generateIdentityKeyPair().pub));
});
