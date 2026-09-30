import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MIN_PASSWORD_LENGTH } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import type { Route } from '../App';

export function SettingsScreen({ navigate }: { navigate: (r: Route) => void }) {
  const c = useClient();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword() {
    if (newPw.length < MIN_PASSWORD_LENGTH) return setPwMsg({ ok: false, text: `At least ${MIN_PASSWORD_LENGTH} characters` });
    if (newPw !== newPw2) return setPwMsg({ ok: false, text: 'The two new passwords are different' });
    try {
      await client.changePassword(oldPw, newPw);
      setPwMsg({ ok: true, text: 'Password changed' });
      setOldPw('');
      setNewPw('');
      setNewPw2('');
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  const logout = () =>
    Alert.alert('Log out', 'Log out on this phone? Chats here are cleared. Log in again any time with your ID and password.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        onPress: () => {
          navigate({ name: 'list' });
          void client.logout();
        },
      },
    ]);

  const wipe = () =>
    Alert.alert('Delete account', 'Delete your account and wipe all keys from this phone? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          navigate({ name: 'list' });
          void client.deleteAccount().catch(() => {});
        },
      },
    ]);

  const pwInput = (value: string, onChangeText: (t: string) => void, placeholder: string) => (
    <TextInput
      style={[s.input, { marginBottom: 8 }]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      secureTextEntry
      autoCapitalize="none"
    />
  );

  return (
    <View style={s.fill}>
      <View style={s.header}>
        <Pressable style={s.iconBtn} onPress={() => navigate({ name: 'list' })}>
          <Text style={s.icon}>‹</Text>
        </Pressable>
        <Text style={[s.text, { fontWeight: '700', fontSize: 17 }]}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={s.text}>
          Signed in as <Text style={{ fontWeight: '700' }}>{c.account?.username}</Text>
        </Text>
        <Text style={s.muted}>{c.account?.serverUrl}</Text>

        <Text style={s.h4}>Change password</Text>
        {pwInput(oldPw, setOldPw, 'Current password')}
        {pwInput(newPw, setNewPw, 'New password')}
        {pwInput(newPw2, setNewPw2, 'Repeat new password')}
        {pwMsg && <Text style={{ color: pwMsg.ok ? colors.ok : colors.danger }}>{pwMsg.text}</Text>}
        <Pressable style={[s.button, (!oldPw || !newPw) && { opacity: 0.5 }]} disabled={!oldPw || !newPw} onPress={changePassword}>
          <Text style={s.buttonText}>Change password</Text>
        </Pressable>

        <Text style={s.h4}>Security on this phone</Text>
        {[
          'End-to-end encryption: X3DH + Double Ratchet (Signal protocol)',
          'Messages and files live in memory only and vanish when the app closes',
          'Keys stored only in the iOS Keychain / Android Keystore, excluded from backups',
          'Screenshots, screen recording and app-switcher previews are blocked',
          'No storage permission: the app cannot save any file to your phone',
          'Calls: WebRTC with keys exchanged over the encrypted channel',
        ].map((t) => (
          <Text key={t} style={[s.muted, { marginBottom: 6 }]}>
            • {t}
          </Text>
        ))}

        <View style={[s.row, { gap: 8, marginTop: 20 }]}>
          <Pressable style={[s.button, { flex: 1 }]} onPress={logout}>
            <Text style={s.buttonText}>Log out</Text>
          </Pressable>
          <Pressable style={[s.button, s.danger, { flex: 1 }]} onPress={wipe}>
            <Text style={s.buttonText}>Delete account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
