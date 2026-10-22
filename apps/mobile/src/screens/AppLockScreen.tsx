import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { Check, Fingerprint, KeyRound, Lock, LockOpen, ScanFace } from 'lucide-react-native';
import { AUTO_LOCK_OPTIONS } from '@meetme/core';
import { appLock, useLock } from '../messenger';
import { biometryLabel, disableBiometricUnlock, enableBiometricUnlock } from '../biometrics';
import { PinPad } from '../PinPad';
import { colors, s } from '../theme';
import { Header, Row, errorText } from '../ui';
import type { Route } from '../App';

type Step =
  | { name: 'overview' }
  | { name: 'new'; first?: string }
  | { name: 'verify'; then: 'disable' | 'change' };

export function AppLockScreen({ navigate, onToast }: { navigate: (r: Route) => void; onToast: (m: string) => void }) {
  const lock = useLock();
  const [step, setStep] = useState<Step>(lock.enabled ? { name: 'overview' } : { name: 'new' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioLabel, setBioLabel] = useState<string | null>(null);

  useEffect(() => {
    void biometryLabel().then(setBioLabel);
  }, []);

  const back = () => (step.name === 'overview' || !lock.enabled ? navigate({ name: 'settings' }) : setStep({ name: 'overview' }));

  const onNewPin = useCallback(
    async (pin: string) => {
      if (step.name !== 'new') return;
      if (!step.first) {
        setError(null);
        setStep({ name: 'new', first: pin });
        return;
      }
      if (pin !== step.first) {
        setError('PINs did not match. Try again.');
        setStep({ name: 'new' });
        return;
      }
      setBusy(true);
      try {
        await appLock.setPin(pin);
        onToast('App lock is on');
        setStep({ name: 'overview' });
        setError(null);
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(false);
      }
    },
    [step, onToast],
  );

  const onVerify = useCallback(
    async (pin: string) => {
      if (step.name !== 'verify') return;
      setBusy(true);
      try {
        if (step.then === 'disable') {
          if (await appLock.disable(pin)) {
            await disableBiometricUnlock();
            onToast('App lock is off');
            navigate({ name: 'settings' });
          } else setError(appLock.lockoutRemaining ? 'Too many wrong attempts. Wait and try again.' : 'Wrong PIN');
        } else if (await appLock.unlock(pin)) {
          setError(null);
          setStep({ name: 'new' });
        } else setError(appLock.lockoutRemaining ? 'Too many wrong attempts. Wait and try again.' : 'Wrong PIN');
      } finally {
        setBusy(false);
      }
    },
    [step, navigate, onToast],
  );

  async function toggleBiometrics(on: boolean) {
    if (on) {
      if (!(await enableBiometricUnlock())) return onToast(`${bioLabel ?? 'Biometric'} unlock was not confirmed`);
    } else await disableBiometricUnlock();
    await appLock.setBiometrics(on);
  }

  if (step.name !== 'overview') {
    const creating = step.name === 'new';
    return (
      <View style={s.screen}>
        <Header title="App lock" onBack={back} />
        <View style={[s.center, { justifyContent: 'flex-start', paddingTop: 32 }]}>
          <PinPad
            title={creating ? (step.first ? 'Confirm your PIN' : 'Choose a 6-digit PIN') : 'Enter your current PIN'}
            subtitle={
              creating
                ? step.first
                  ? 'Enter the same PIN again'
                  : 'You will need it every time you open CellMate'
                : undefined
            }
            error={error}
            busy={busy}
            onComplete={creating ? onNewPin : onVerify}
          />
        </View>
      </View>
    );
  }

  const BioIcon = bioLabel === 'Face ID' ? ScanFace : Fingerprint;

  return (
    <View style={s.fill}>
      <Header title="App lock" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={[s.card, s.row, { padding: 16, gap: 14 }]}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: colors.okSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Lock size={22} color={colors.ok} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>App lock is on</Text>
            <Text style={[s.muted, { marginTop: 2 }]}>CellMate asks for your PIN when it opens.</Text>
          </View>
        </View>

        {bioLabel && (
          <>
            <Text style={s.section}>Biometrics</Text>
            <View style={[s.card, { padding: 4 }]}>
              <Row
                icon={BioIcon}
                title={`Unlock with ${bioLabel}`}
                subtitle="Your PIN still works as a backup"
                right={
                  <Switch
                    value={lock.biometrics}
                    onValueChange={(v) => void toggleBiometrics(v)}
                    trackColor={{ true: colors.accent, false: colors.lineStrong }}
                    thumbColor="#fff"
                  />
                }
              />
            </View>
          </>
        )}

        <Text style={s.section}>Lock automatically</Text>
        <View style={[s.card, { paddingVertical: 4 }]}>
          {AUTO_LOCK_OPTIONS.map(([sec, label], i) => (
            <View key={sec}>
              {i > 0 && <View style={[s.divider, { marginLeft: 16 }]} />}
              <Row
                title={label}
                onPress={() => void appLock.setAutoLock(sec)}
                right={lock.autoLockSec === sec ? <Check size={18} color={colors.accent} strokeWidth={2.4} /> : null}
              />
            </View>
          ))}
        </View>

        <Text style={s.section}>PIN</Text>
        <View style={[s.card, { padding: 4 }]}>
          <Row icon={KeyRound} title="Change PIN" onPress={() => setStep({ name: 'verify', then: 'change' })} />
          <Row icon={LockOpen} title="Turn off app lock" danger onPress={() => setStep({ name: 'verify', then: 'disable' })} />
        </View>
      </ScrollView>
    </View>
  );
}
