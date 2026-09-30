import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppLock, MemoryStorage } from '../src/index';

test('app lock: set PIN, starts locked on next load, unlocks only with the right PIN', async () => {
  const storage = new MemoryStorage();
  const lock = new AppLock(storage);
  await lock.load();
  assert.equal(lock.enabled, false);
  assert.equal(lock.locked, false);

  await assert.rejects(lock.setPin('12a4'));
  await assert.rejects(lock.setPin('12'));
  await lock.setPin('482913');
  assert.equal(lock.enabled, true);
  assert.equal(lock.locked, false);
  assert.ok(!(await storage.getItem('setting:applock'))!.includes('482913'), 'PIN is not stored in clear');

  const again = new AppLock(storage);
  await again.load();
  assert.equal(again.locked, true);
  assert.equal(await again.unlock('000000'), false);
  assert.equal(again.locked, true);
  assert.equal(await again.unlock('482913'), true);
  assert.equal(again.locked, false);
});

test('app lock: wrong guesses are throttled and the counter survives a restart', async () => {
  let now = 1_000_000;
  const storage = new MemoryStorage();
  const lock = new AppLock(storage, () => now);
  await lock.setPin('1234');
  for (let i = 0; i < 5; i++) assert.equal(await lock.unlock('9999'), false);
  assert.ok(lock.lockoutRemaining > 0);
  // Even the right PIN is refused during the lockout.
  assert.equal(await lock.unlock('1234'), false);

  const restarted = new AppLock(storage, () => now);
  await restarted.load();
  assert.ok(restarted.lockoutRemaining > 0, 'lockout survives restart');
  now += 31_000;
  assert.equal(await restarted.unlock('1234'), true);
  assert.equal(restarted.failedAttempts, 0);
});

test('app lock: auto-lock after background time, disable needs the PIN', async () => {
  let now = 0;
  const lock = new AppLock(new MemoryStorage(), () => now);
  await lock.setPin('2468', { autoLockSec: 60 });
  lock.onBackground();
  now += 30_000;
  lock.onForeground();
  assert.equal(lock.locked, false);
  lock.onBackground();
  now += 61_000;
  lock.onForeground();
  assert.equal(lock.locked, true);
  assert.equal(await lock.disable('1111'), false);
  assert.equal(await lock.disable('2468'), true);
  assert.equal(lock.enabled, false);
  assert.equal(lock.locked, false);
});
