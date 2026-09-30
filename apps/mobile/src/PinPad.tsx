import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Delete, type LucideIcon } from 'lucide-react-native';
import { colors, s } from './theme';

export const PIN_LENGTH = 6;

/**
 * On-screen number pad. Used instead of the system keyboard so no keyboard app can learn the PIN,
 * and the digits never go through autofill or clipboard.
 */
export function PinPad({
  title,
  subtitle,
  error,
  busy,
  onComplete,
  extraKey,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  busy?: boolean;
  onComplete: (pin: string) => void;
  /** Optional button in the bottom-left slot (e.g. fingerprint). */
  extraKey?: { icon: LucideIcon; label: string; onPress: () => void };
}) {
  const [pin, setPin] = useState('');

  useEffect(() => {
    if (pin.length === PIN_LENGTH) {
      onComplete(pin);
      setPin('');
    }
  }, [pin, onComplete]);

  const press = (d: string) => !busy && setPin((p) => (p.length < PIN_LENGTH ? p + d : p));
  const back = () => !busy && setPin((p) => p.slice(0, -1));

  const Extra = extraKey?.icon;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <View style={{ alignItems: 'center', gap: 28, width: '100%' }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={[s.h1, { fontSize: 22 }]}>{title}</Text>
        {subtitle && <Text style={[s.muted, { textAlign: 'center', fontSize: 14 }]}>{subtitle}</Text>}
      </View>

      <View style={{ height: 24, justifyContent: 'center' }}>
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <View style={[s.row, { gap: 16 }]}>
            {Array.from({ length: PIN_LENGTH }, (_, i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotOn, !!error && styles.dotError]} />
            ))}
          </View>
        )}
      </View>
      <Text style={{ color: colors.danger, fontSize: 13.5, minHeight: 18, textAlign: 'center' }}>{error ?? ''}</Text>

      <View style={styles.grid}>
        {keys.map((k) => (
          <Key key={k} onPress={() => press(k)}>
            <Text style={styles.digit}>{k}</Text>
          </Key>
        ))}
        {Extra ? (
          <Key onPress={extraKey!.onPress} label={extraKey!.label}>
            <Extra size={26} color={colors.accent} />
          </Key>
        ) : (
          <View style={styles.key} />
        )}
        <Key onPress={() => press('0')}>
          <Text style={styles.digit}>0</Text>
        </Key>
        <Key onPress={back} label="Delete">
          <Delete size={24} color={colors.text2} />
        </Key>
      </View>
    </View>
  );
}

function Key({ children, onPress, label }: { children: React.ReactNode; onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.key, styles.keyBg, pressed && { backgroundColor: colors.lineStrong }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: colors.lineStrong },
  dotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dotError: { borderColor: colors.danger },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 288, justifyContent: 'space-between', rowGap: 16 },
  key: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  keyBg: { backgroundColor: colors.hover },
  digit: { fontSize: 28, fontWeight: '500', color: colors.text },
});
