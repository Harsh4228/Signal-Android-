import { useCallback, useEffect, useState } from 'react';
import { appLock, useLock } from '../messenger';
import { PinInput } from './PinInput';
import { Logo } from './ui';

/** Covers the whole window until the correct PIN is entered. */
export function LockScreen() {
  const lock = useLock();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  const waitMs = lock.lockoutRemaining;
  useEffect(() => {
    if (!waitMs) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [waitMs]);

  const onComplete = useCallback(async (pin: string) => {
    setBusy(true);
    const ok = await appLock.unlock(pin);
    setBusy(false);
    if (ok) return setError(null);
    setError(
      appLock.lockoutRemaining > 0
        ? 'Too many wrong attempts'
        : `Wrong PIN (${appLock.failedAttempts} failed attempt${appLock.failedAttempts === 1 ? '' : 's'})`,
    );
  }, []);

  const wait = Math.ceil(waitMs / 1000);

  return (
    <div className="lockscreen">
      <div className="lock-card">
        <Logo large />
        <h1>CellMate is locked</h1>
        <p className="muted">{wait ? `Too many attempts. Try again in ${wait} s.` : busy ? 'Checking…' : 'Enter your 6-digit PIN'}</p>
        <PinInput onComplete={onComplete} disabled={busy || wait > 0} error={!!error && !wait} />
        <div className="lock-error">{wait ? '' : (error ?? '')}</div>
      </div>
    </div>
  );
}
