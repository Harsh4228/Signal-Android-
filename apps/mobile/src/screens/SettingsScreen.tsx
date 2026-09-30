import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { CircleAlert, CircleCheck, LogOut, Trash2 } from 'lucide-react-native';
import { MIN_PASSWORD_LENGTH } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, Banner, Button, Field, Header, Row, errorText } from '../ui';
import type { Route } from '../App';

const SECURITY = [
  'End-to-end encryption with the Signal protocol (X3DH + Double Ratchet)',
  'Messages and files live in memory only and vanish when the app closes',
  'Keys stored only in the iOS Keychain / Android Keystore, excluded from backups',
  'Screenshots, screen recording and app-switcher previews are blocked',
  'No storage permission: the app cannot save any file to your phone',
  'Calls use WebRTC with keys exchanged over the encrypted channel',
];

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
      setPwMsg({ ok: false, text: errorText(e) });
    }
  }

  const logout = () =>
    Alert.alert('Sign out', 'Sign out on this phone? Chats here are cleared. Sign in again any time with your ID and password.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
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

  return (
    <View style={s.fill}>
      <Header title="Settings" onBack={() => navigate({ name: 'list' })} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={[s.card, s.row, { padding: 16, gap: 14 }]}>
          <Avatar name={c.account?.username ?? '?'} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { fontSize: 18 }]}>{c.account?.username}</Text>
            <Text style={s.muted} numberOfLines={1}>
              {c.account?.serverUrl}
            </Text>
          </View>
        </View>

        <Text style={s.section}>Change password</Text>
        <View style={[s.card, { padding: 16, gap: 10 }]}>
          <Field value={oldPw} onChangeText={setOldPw} placeholder="Current password" secureTextEntry />
          <Field value={newPw} onChangeText={setNewPw} placeholder="New password" secureTextEntry />
          <Field value={newPw2} onChangeText={setNewPw2} placeholder="Confirm new password" secureTextEntry />
          {pwMsg && (
            <Banner kind={pwMsg.ok ? 'ok' : 'error'} icon={pwMsg.ok ? CircleCheck : CircleAlert}>
              {pwMsg.text}
            </Banner>
          )}
          <Button title="Update password" disabled={!oldPw || !newPw} onPress={changePassword} />
        </View>

        <Text style={s.section}>Security on this phone</Text>
        <View style={[s.card, { padding: 16, gap: 12 }]}>
          {SECURITY.map((t) => (
            <View key={t} style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
              <CircleCheck size={17} color={colors.ok} style={{ marginTop: 1 }} />
              <Text style={[s.text, { flex: 1, fontSize: 14, color: colors.text2, lineHeight: 20 }]}>{t}</Text>
            </View>
          ))}
        </View>

        <Text style={s.section}>Account</Text>
        <View style={[s.card, { padding: 4 }]}>
          <Row icon={LogOut} title="Sign out" onPress={logout} />
          <Row icon={Trash2} title="Delete account" subtitle="Wipes all keys from this phone" danger onPress={wipe} />
        </View>
      </ScrollView>
    </View>
  );
}
