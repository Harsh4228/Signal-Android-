import { bytesEqual, fromBase64, toBase64, utf8, fromUtf8 } from './encoding';
import { DuplicateMessageError, initReceiver, initSender, ratchetDecrypt, ratchetEncrypt } from './crypto/ratchet';
import { x3dhInitiate, x3dhRespond, type PreKeyBundle } from './crypto/x3dh';
import type { ProtocolStore, SessionRecord } from './store';

/** What travels over the network (as JSON). The server only ever sees this - never plaintext. */
export type WireMessage =
  | { v: 1; t: 'prekey'; ik: string; ek: string; spk: number; opk?: number; h: string; c: string }
  | { v: 1; t: 'msg'; h: string; c: string };

const MAX_ARCHIVED_SESSIONS = 5;

export class NoSessionError extends Error {
  constructor(peer: string) {
    super(`no session with ${peer}`);
  }
}

export type IdentityStatus = 'new' | 'same' | 'changed';

/**
 * Session layer: glues X3DH + Double Ratchet + storage together.
 * Callers must serialize calls per peer (MessengerClient does this with a lock).
 */
export class SessionCipher {
  constructor(private readonly store: ProtocolStore) {}

  async hasSession(peer: string): Promise<boolean> {
    return (await this.store.getSessions(peer)).length > 0;
  }

  /** Trust-on-first-use. Returns 'changed' if the peer's identity key differs from what we saw before. */
  async checkIdentity(peer: string, key: Uint8Array): Promise<IdentityStatus> {
    const known = await this.store.getIdentity(peer);
    if (!known) {
      await this.store.saveIdentity(peer, { key, verified: false, firstSeen: Date.now() });
      return 'new';
    }
    if (bytesEqual(known.key, key)) return 'same';
    await this.store.saveIdentity(peer, { key, verified: false, firstSeen: Date.now() });
    return 'changed';
  }

  /** Start a new outgoing session from the peer's prekey bundle (fetched from the server). */
  async initOutgoing(peer: string, bundle: PreKeyBundle): Promise<IdentityStatus> {
    const account = await this.store.getAccount();
    if (!account) throw new Error('not registered');
    const x = x3dhInitiate(account.identity, bundle);
    const state = initSender(x.sharedKey, bundle.signedPreKey.pub, x.associatedData);
    const status = await this.checkIdentity(peer, bundle.identityKey);
    const record: SessionRecord = {
      state,
      theirIdentity: bundle.identityKey,
      baseKey: x.ephemeralPub,
      pending: { ek: x.ephemeralPub, spkId: x.signedPreKeyId, opkId: x.oneTimePreKeyId },
      createdAt: Date.now(),
    };
    const existing = await this.store.getSessions(peer);
    await this.store.saveSessions(peer, [record, ...existing].slice(0, MAX_ARCHIVED_SESSIONS));
    return status;
  }

  async encrypt(peer: string, plaintext: string): Promise<WireMessage> {
    const sessions = await this.store.getSessions(peer);
    const current = sessions[0];
    if (!current) throw new NoSessionError(peer);
    const { state, header, ciphertext } = ratchetEncrypt(current.state, utf8(plaintext));
    current.state = state;
    await this.store.saveSessions(peer, sessions);

    const h = toBase64(header);
    const c = toBase64(ciphertext);
    if (current.pending) {
      const account = (await this.store.getAccount())!;
      return {
        v: 1,
        t: 'prekey',
        ik: toBase64(account.identity.pub),
        ek: toBase64(current.pending.ek),
        spk: current.pending.spkId,
        opk: current.pending.opkId,
        h,
        c,
      };
    }
    return { v: 1, t: 'msg', h, c };
  }

  async decrypt(
    peer: string,
    msg: WireMessage,
  ): Promise<{ plaintext: string; identityStatus?: IdentityStatus }> {
    if (!msg || msg.v !== 1) throw new Error('unsupported message version');
    const header = fromBase64(msg.h);
    const ciphertext = fromBase64(msg.c);
    const sessions = await this.store.getSessions(peer);

    if (msg.t === 'prekey') {
      const ek = fromBase64(msg.ek);
      const ik = fromBase64(msg.ik);
      // Repeated prekey message for a session we already built?
      const idx = sessions.findIndex((s) => bytesEqual(s.baseKey, ek));
      if (idx >= 0) return { plaintext: await this.decryptWith(peer, sessions, idx, header, ciphertext) };

      const account = await this.store.getAccount();
      if (!account) throw new Error('not registered');
      const spk = (await this.store.getSignedPreKeys()).find((k) => k.id === msg.spk);
      if (!spk) throw new Error('unknown signed prekey');
      const opks = await this.store.getOneTimePreKeys();
      let opk;
      if (msg.opk !== undefined) {
        opk = opks.keys.get(msg.opk);
        if (!opk) throw new Error('one-time prekey already used (possible replay)');
      }
      const x = x3dhRespond({
        ourIdentity: account.identity,
        ourSignedPreKey: spk.keyPair,
        ourOneTimePreKey: opk,
        theirIdentityKey: ik,
        theirEphemeralKey: ek,
      });
      const fresh = initReceiver(x.sharedKey, spk.keyPair, x.associatedData);
      const { state, plaintext } = ratchetDecrypt(fresh, header, ciphertext); // throws if forged
      // Success - now commit everything.
      if (msg.opk !== undefined) {
        opks.keys.delete(msg.opk);
        await this.store.saveOneTimePreKeys(opks);
      }
      const identityStatus = await this.checkIdentity(peer, ik);
      const record: SessionRecord = { state, theirIdentity: ik, baseKey: ek, createdAt: Date.now() };
      await this.store.saveSessions(peer, [record, ...sessions].slice(0, MAX_ARCHIVED_SESSIONS));
      return { plaintext: fromUtf8(plaintext), identityStatus };
    }

    if (msg.t === 'msg') {
      let lastErr: unknown = new NoSessionError(peer);
      for (let i = 0; i < sessions.length; i++) {
        try {
          return { plaintext: await this.decryptWith(peer, sessions, i, header, ciphertext) };
        } catch (e) {
          if (e instanceof DuplicateMessageError) throw e; // right session, message already seen
          lastErr = e;
        }
      }
      throw lastErr;
    }
    throw new Error('unknown message type');
  }

  private async decryptWith(
    peer: string,
    sessions: SessionRecord[],
    idx: number,
    header: Uint8Array,
    ciphertext: Uint8Array,
  ): Promise<string> {
    const rec = sessions[idx]!;
    const { state, plaintext } = ratchetDecrypt(rec.state, header, ciphertext);
    rec.state = state;
    delete rec.pending; // peer answered -> no need to keep sending prekey messages
    sessions.splice(idx, 1);
    sessions.unshift(rec); // the session that works becomes the active one
    await this.store.saveSessions(peer, sessions);
    return fromUtf8(plaintext);
  }
}
