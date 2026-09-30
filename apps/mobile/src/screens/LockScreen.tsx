import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Fingerprint, ScanFace } from 'lucide-react-native';
import { appLock, useLock } from '../messenger';
import { biometryLabel, verifyBiometrics } from '../biometrics';
import { PinPad } from '../PinPad';
import { colors } from '../theme';
import { Logo } from '../ui';

/** Full-screen lock. Covers everything (including an active call's UI) until the PIN or biometrics succeed. */
export function LockScreen() {
  const lock = useLock();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioLabel, setBioLabel] = useState<string | null>(null);
  const [, tick] = useState(0);

  const tryBiometrics = useCallback(async () => {
    if (await verifyBiometrics()) await appLock.unlockWithBiometrics();
  }, []);

  useEffect(() => {
    if (!lock.biometrics) return;
    void biometryLabel().then(setBioLabel);
    void tryBiometrics();
  }, [lock.biometrics, tryBiometrics]);

  // Re-render every second while a lockout countdown is running.
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
    if (!ok) {
      setError(
        appLock.lockoutRemaining > 0
          ? 'Too many wrong attempts'
          : `Wrong PIN (${appLock.failedAttempts} failed attempt${appLock.failedAttempts === 1 ? '' : 's'})`,
      );
    } else setError(null);
  }, []);

  const wait = Math.ceil(waitMs / 1000);

  return (
    <View style={[StyleSheet.absoluteFill, styles.bg]}>
      <Logo size={56} />
      <PinPad
        title="MeetMe is locked"
        subtitle={wait ? `Try again in ${wait} s` : 'Enter your PIN to continue'}
        error={wait ? null : error}
        busy={busy || wait > 0}
        onComplete={onComplete}
        extraKey={
          lock.biometrics && bioLabel
            ? { icon: bioLabel === 'Face ID' ? ScanFace : Fingerprint, label: bioLabel, onPress: () => void tryBiometrics() }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingHorizontal: 24,
  },
});
