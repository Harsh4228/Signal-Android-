import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowLeft, CircleAlert, KeyRound, LockKeyhole } from 'lucide-react-native';
import { MIN_PASSWORD_LENGTH, MustChangePasswordError } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Banner, Button, Field, Logo, errorText } from '../ui';

/** Employees log in with the ID + password from their admin. "Create account" is for the admin's first setup. */
export function RegisterScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [server, setServer] = useState('https://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (mustChange) {
      if (newPw.length < MIN_PASSWORD_LENGTH) return setError(`New password: at least ${MIN_PASSWORD_LENGTH} characters`);
      if (newPw !== newPw2) return setError('The two new passwords are different');
    }
    setBusy(true);
    try {
      if (mode === 'register') await client.register(server, username);
      else await client.login(server, username, password, mustChange ? newPw : undefined);
      onDone();
    } catch (e) {
      if (e instanceof MustChangePasswordError) setMustChange(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    username.length >= 3 && (mode === 'register' || (password.length > 0 && (!mustChange || newPw.length > 0)));

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 16 }}>
          <View style={{ alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Logo size={60} />
            <Text style={[s.h1, { marginTop: 8 }]}>{mode === 'login' ? 'Sign in to MeetMe' : 'Set up MeetMe'}</Text>
            <Text style={[s.muted, { textAlign: 'center', fontSize: 14, lineHeight: 20 }]}>
              {mode === 'login'
                ? 'Use the ID and password you received from your administrator.'
                : 'Create the first administrator account for your server.'}
            </Text>
          </View>

          <Field label="Server address" value={server} onChangeText={setServer} keyboardType="url" placeholder="https://chat.yourcompany.com" />
          <Field
            label={mode === 'login' ? 'User ID' : 'Username'}
            value={username}
            onChangeText={(t) => setUsername(t.toLowerCase())}
            placeholder="e.g. ravi.k"
            editable={!mustChange}
          />
          {mode === 'login' && (
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry editable={!mustChange} />
          )}

          {mustChange && (
            <>
              <Banner kind="warn" icon={KeyRound}>
                First sign-in: choose your own password. After this, not even your administrator knows it.
              </Banner>
              <Field label="New password" value={newPw} onChangeText={setNewPw} secureTextEntry />
              <Field label="Confirm new password" value={newPw2} onChangeText={setNewPw2} secureTextEntry />
            </>
          )}

          {error && (
            <Banner kind="error" icon={CircleAlert}>
              {error}
            </Banner>
          )}
          <Button
            variant="primary"
            title={
              busy
                ? 'Creating your encryption keys…'
                : mode === 'register'
                  ? 'Create administrator account'
                  : mustChange
                    ? 'Save password and sign in'
                    : 'Sign in'
            }
            busy={busy}
            disabled={!canSubmit}
            onPress={submit}
            style={{ marginTop: 4 }}
          />

          <Pressable
            onPress={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setMustChange(false);
              setError(null);
            }}
            style={[s.row, { justifyContent: 'center', gap: 6, paddingVertical: 6 }]}
          >
            {mode === 'register' && <ArrowLeft size={15} color={colors.accent} />}
            <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 14 }}>
              {mode === 'login' ? 'Administrator? Set up a new server' : 'Back to sign in'}
            </Text>
          </Pressable>

          <View style={[s.divider, { marginTop: 4 }]} />
          <View style={[s.row, { gap: 8, justifyContent: 'center' }]}>
            <LockKeyhole size={14} color={colors.muted} />
            <Text style={[s.muted, { fontSize: 12.5 }]}>Your keys are created on this phone and never leave it.</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
