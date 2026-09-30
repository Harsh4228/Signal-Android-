import { toBase64 } from './encoding';
import { generateIdentityKeyPair, generateKeyPair, randomBytes } from './crypto/primitives';
import { signPreKey } from './crypto/x3dh';
import type { Account, ProtocolStore, SignedPreKeyRecord } from './store';

export const ONE_TIME_PREKEY_BATCH = 100;
export const ONE_TIME_PREKEY_LOW_WATER = 20;
const SPK_ROTATE_MS = 7 * 24 * 3600 * 1000;
const SPK_KEEP = 3; // keep a few old signed prekeys so delayed prekey messages still decrypt

export interface PublicSignedPreKey {
  id: number;
  pub: string;
  sig: string;
}
export interface PublicOneTimePreKey {
  id: number;
  pub: string;
}

export async function createAccount(
  store: ProtocolStore,
  serverUrl: string,
  username: string,
): Promise<{ account: Account; signedPreKey: PublicSignedPreKey; oneTimePreKeys: PublicOneTimePreKey[] }> {
  await store.wipe();
  const account: Account = {
    serverUrl,
    username,
    password: toBase64(randomBytes(32)),
    identity: generateIdentityKeyPair(),
  };
  await store.saveAccount(account);
  const spk = makeSignedPreKey(account, 1);
  await store.saveSignedPreKeys([spk]);
  const oneTimePreKeys = await generateOneTimePreKeys(store, ONE_TIME_PREKEY_BATCH);
  return { account, signedPreKey: publicSpk(spk), oneTimePreKeys };
}

function makeSignedPreKey(account: Account, id: number): SignedPreKeyRecord {
  const keyPair = generateKeyPair();
  return { id, keyPair, sig: signPreKey(account.identity, keyPair.pub), createdAt: Date.now() };
}

export const publicSpk = (r: SignedPreKeyRecord): PublicSignedPreKey => ({
  id: r.id,
  pub: toBase64(r.keyPair.pub),
  sig: toBase64(r.sig),
});

export async function generateOneTimePreKeys(store: ProtocolStore, count: number): Promise<PublicOneTimePreKey[]> {
  const opks = await store.getOneTimePreKeys();
  const out: PublicOneTimePreKey[] = [];
  for (let i = 0; i < count; i++) {
    const id = opks.nextId++;
    const k = generateKeyPair();
    opks.keys.set(id, k);
    out.push({ id, pub: toBase64(k.pub) });
  }
  await store.saveOneTimePreKeys(opks);
  return out;
}

/** Returns a new signed prekey to upload if the current one is older than 7 days. */
export async function maybeRotateSignedPreKey(store: ProtocolStore): Promise<PublicSignedPreKey | null> {
  const account = await store.getAccount();
  if (!account) return null;
  const list = await store.getSignedPreKeys();
  const newest = list.reduce<SignedPreKeyRecord | null>((a, r) => (!a || r.id > a.id ? r : a), null);
  if (newest && Date.now() - newest.createdAt < SPK_ROTATE_MS) return null;
  const next = makeSignedPreKey(account, (newest?.id ?? 0) + 1);
  const kept = [next, ...list.sort((a, b) => b.id - a.id)].slice(0, SPK_KEEP);
  await store.saveSignedPreKeys(kept);
  return publicSpk(next);
}
