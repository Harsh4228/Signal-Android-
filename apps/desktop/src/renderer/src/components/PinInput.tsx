import { useEffect, useRef, useState } from 'react';

export const PIN_LENGTH = 6;

/** Six-dot PIN entry. Typing (or pasting) digits fills the dots; calls onComplete at 6 digits. */
export function PinInput({
  onComplete,
  disabled,
  error,
}: {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  error?: boolean;
}) {
  const [pin, setPin] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);

  useEffect(() => {
    if (pin.length === PIN_LENGTH) {
      onComplete(pin);
      setPin('');
    }
  }, [pin, onComplete]);

  return (
    <div className={`pin ${error ? 'error' : ''}`} onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        className="pin-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        disabled={disabled}
        maxLength={PIN_LENGTH}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
        onBlur={() => !disabled && setTimeout(() => ref.current?.focus(), 0)}
        aria-label="PIN"
      />
      {Array.from({ length: PIN_LENGTH }, (_, i) => (
        <span key={i} className={`pin-dot ${i < pin.length ? 'on' : ''}`} />
      ))}
    </div>
  );
}
