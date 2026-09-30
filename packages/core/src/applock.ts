import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from './crypto/primitives';
import { Emitter } from './emitter';
import { fromBase64, toBase64, utf8 } from './encoding';
import type { SecureStorage } from './store';

/**
 * App lock: a PIN (and, on phones, fingerprint / Face ID) that must be entered when the app opens
 * and after it has been in the background for a while.
 *
 * The PIN is never stored: only a salted PBKDF2-SHA256 hash, inside the platform's secure storage.
 * Wrong guesses are throttled with a delay that doubles after every 5 failures, and the counter
 * survives restarts so it can't be reset by killing the app.
 */

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;
const ITERATIONS = 60_000;
const KEY = 'setting:applock';
const FREE_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 30_000;

export const AUTO_LOCK_OPTIONS: [number, string][] = [
  [0, 'Immediately'],
  [60, 'After 1 minute'],
  [300, 'After 5 minutes'],
  [900, 'After 15 minutes'],
  [3600, 'After 1 hour'],
];

interface Stored {
  salt: string;
  hash: string;
  iter: number;
  autoLockSec: number;
  biometrics: boolean;
  failed: number;
  lockoutUntil: number;
}

export class AppLock extends Emitter<{ change: [] }> {
  private cfg: Stored | null = null;
  /** True while the lock screen must be shown. */
  locked = false;
  private backgroundSince: number | null = null;

  constructor(
    private readonly storage: SecureStorage,
    private readonly now: () => number = Date.now,
  ) {
    super();
  }

  /** Read the saved settings. An enabled lock starts locked. */
  async load(): Promise<void> {
    const raw = await this.storage.getItem(KEY);
    this.cfg = raw ? (JSON.parse(raw) as Stored) : null;
    this.locked = !!this.cfg;
    this.emit('change');
  }

  get enabled(): boolean {
    return !!this.cfg;
  }
  get autoLockSec(): number {
    return this.cfg?.autoLockSec ?? 60;
  }
  get biometrics(): boolean {
    return !!this.cfg?.biometrics;
  }
  /** Milliseconds until another PIN attempt is allowed (0 = allowed now). */
  get lockoutRemaining(): number {
    return Math.max(0, (this.cfg?.lockoutUntil ?? 0) - this.now());
  }
  get failedAttempts(): number {
    return this.cfg?.failed ?? 0;
  }

  async setPin(pin: string, opts: { autoLockSec?: number; biometrics?: boolean } = {}): Promise<void> {
    checkPin(pin);
    const salt = randomBytes(16);
    this.cfg = {
      salt: toBase64(salt),
      hash: toBase64(await derive(pin, salt, ITERATIONS)),
      iter: ITERATIONS,
      autoLockSec: opts.autoLockSec ?? this.cfg?.autoLockSec ?? 60,
      biometrics: opts.biometrics ?? this.cfg?.biometrics ?? false,
      failed: 0,
      lockoutUntil: 0,
    };
    this.locked = false;
    await this.save();
  }

  /** Turn the lock off. Requires the current PIN. */
  async disable(pin: string): Promise<boolean> {
    if (!(await this.check(pin))) return false;
    this.cfg = null;
    this.locked = false;
    await this.storage.removeItem(KEY);
    this.emit('change');
    return true;
  }

  async setAutoLock(sec: number): Promise<void> {
    if (!this.cfg) return;
    this.cfg.autoLockSec = sec;
    await this.save();
  }

  async setBiometrics(on: boolean): Promise<void> {
    if (!this.cfg) return;
    this.cfg.biometrics = on;
    await this.save();
  }

  /** Try a PIN on the lock screen. Returns false for a wrong PIN or while throttled. */
  async unlock(pin: string): Promise<boolean> {
    const ok = await this.check(pin);
    if (ok) {
      this.locked = false;
      this.emit('change');
    }
    return ok;
  }

  /** Unlock after the platform confirmed fingerprint / Face ID. */
  async unlockWithBiometrics(): Promise<void> {
    if (!this.cfg?.biometrics) return;
    this.cfg.failed = 0;
    this.cfg.lockoutUntil = 0;
    this.locked = false;
    await this.save();
  }

  lock(): void {
    if (!this.cfg || this.locked) return;
    this.locked = true;
    this.emit('change');
  }

  /** Call when the app goes to the background / window loses focus. */
  onBackground(): void {
    if (!this.cfg) return;
    this.backgroundSince = this.now();
    if (this.cfg.autoLockSec === 0) this.lock();
  }

  /** Call when the app comes back. Locks if it was away longer than the auto-lock time. */
  onForeground(): void {
    if (this.cfg && this.backgroundSince !== null && this.now() - this.backgroundSince >= this.cfg.autoLockSec * 1000) {
      this.lock();
    }
    this.backgroundSince = null;
  }

  private async check(pin: string): Promise<boolean> {
    const cfg = this.cfg;
    if (!cfg) return true;
    if (this.lockoutRemaining > 0) return false;
    const hash = await derive(pin, fromBase64(cfg.salt), cfg.iter);
    if (equal(hash, fromBase64(cfg.hash))) {
      cfg.failed = 0;
      cfg.lockoutUntil = 0;
      await this.save();
      return true;
    }
    cfg.failed += 1;
    if (cfg.failed >= FREE_ATTEMPTS && cfg.failed % FREE_ATTEMPTS === 0) {
      // 30 s, 60 s, 2 min, 4 min ... capped at 1 hour.
      const step = cfg.failed / FREE_ATTEMPTS - 1;
      cfg.lockoutUntil = this.now() + Math.min(BASE_LOCKOUT_MS * 2 ** step, 3600_000);
    }
    await this.save();
    return false;
  }

  private async save() {
    await this.storage.setItem(KEY, JSON.stringify(this.cfg));
    this.emit('change');
  }
}

function checkPin(pin: string) {
  if (!/^\d+$/.test(pin) || pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    throw new Error(`PIN: ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`);
  }
}

function derive(pin: string, salt: Uint8Array, iter: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8(pin), salt, { c: iter, dkLen: 32 });
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}
