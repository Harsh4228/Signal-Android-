import { useCallback, useState } from 'react';
import { KeyRound, Lock, LockOpen, X } from 'lucide-react';
import { AUTO_LOCK_OPTIONS } from '@meetme/core';
import { appLock, useLock } from '../messenger';
import { PinInput } from './PinInput';
import { errorText } from './ui';

type Step = { name: 'new'; first?: string } | { name: 'verify'; then: 'disable' | 'change' };

/** "App lock" section of Settings: turn on, change PIN, auto-lock time, turn off. */
export function AppLockSettings({ onToast }: { onToast: (m: string) => void }) {
  const lock = useLock();
  const [step, setStep] = useState<Step | null>(null);

  return (
    <>
      {lock.enabled ? (
        <div className="stack">
          <div className="ok">
            <Lock size={16} /> App lock is on. CellMate asks for your PIN when it starts and after it has been idle.
          </div>
          <label className="field-label">
            Lock automatically
            <select value={lock.autoLockSec} onChange={(e) => void appLock.setAutoLock(Number(e.target.value))}>
              {AUTO_LOCK_OPTIONS.map(([sec, label]) => (
                <option key={sec} value={sec}>
                  {label === 'Immediately' ? 'When the window loses focus' : `${label} of inactivity`}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button onClick={() => setStep({ name: 'verify', then: 'change' })}>
              <KeyRound size={16} /> Change PIN
            </button>
            <button className="danger" onClick={() => setStep({ name: 'verify', then: 'disable' })}>
              <LockOpen size={16} /> Turn off
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <p className="muted small grow" style={{ margin: 0 }}>
            Require a 6-digit PIN to open CellMate on this computer.
          </p>
          <button className="primary" onClick={() => setStep({ name: 'new' })}>
            <Lock size={16} /> Turn on
          </button>
        </div>
      )}
      {step && <PinDialog step={step} setStep={setStep} onToast={onToast} />}
    </>
  );
}

function PinDialog({
  step,
  setStep,
  onToast,
}: {
  step: Step;
  setStep: (s: Step | null) => void;
  onToast: (m: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wrong = () => setError(appLock.lockoutRemaining ? 'Too many wrong attempts. Wait and try again.' : 'Wrong PIN');

  const onComplete = useCallback(
    async (pin: string) => {
      setBusy(true);
      try {
        if (step.name === 'new') {
          if (!step.first) {
            setError(null);
            return setStep({ name: 'new', first: pin });
          }
          if (pin !== step.first) {
            setError('PINs did not match. Try again.');
            return setStep({ name: 'new' });
          }
          await appLock.setPin(pin);
          onToast('App lock is on');
          return setStep(null);
        }
        if (step.then === 'disable') {
          if (!(await appLock.disable(pin))) return wrong();
          onToast('App lock is off');
          return setStep(null);
        }
        if (!(await appLock.unlock(pin))) return wrong();
        setError(null);
        setStep({ name: 'new' });
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [step, setStep, onToast],
  );

  const title =
    step.name === 'new' ? (step.first ? 'Confirm your PIN' : 'Choose a 6-digit PIN') : 'Enter your current PIN';
  const sub =
    step.name === 'new'
      ? step.first
        ? 'Type the same PIN again.'
        : 'You will need it every time CellMate starts or has been idle.'
      : step.then === 'disable'
        ? 'Confirm it is you before turning off app lock.'
        : 'Confirm it is you before choosing a new PIN.';

  return (
    <div className="modal-bg" onClick={() => setStep(null)} style={{ zIndex: 22 }}>
      <div className="modal pin-modal" onClick={(e) => e.stopPropagation()}>
        <header>
          <div className="title">
            <span className="title-icon">
              <Lock size={18} />
            </span>
            App lock
          </div>
          <button className="icon" onClick={() => setStep(null)} title="Close">
            <X size={18} />
          </button>
        </header>
        <h3>{title}</h3>
        <p className="muted small">{busy ? 'Checking…' : sub}</p>
        {/* key: remount between steps so the dots reset */}
        <PinInput key={`${step.name}-${step.name === 'new' ? !!step.first : step.then}`} onComplete={onComplete} disabled={busy} error={!!error} />
        <div className="lock-error">{error ?? ''}</div>
      </div>
    </div>
  );
}
