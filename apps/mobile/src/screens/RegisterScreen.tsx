import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MIN_PASSWORD_LENGTH, MustChangePasswordError } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';

// Android emulator reaches the PC's localhost at 10.0.2.2
const DEFAULT_SERVER = Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080';

/** Employees log in with the ID + password from their admin. "Create account" is for the admin's first setup. */
export function RegisterScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [server, setServer] = useState(DEFAULT_SERVER);
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
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    username.length >= 3 && (mode === 'register' || (password.length > 0 && (!mustChange || newPw.length > 0)));
  const input = (props: React.ComponentProps<typeof TextInput>) => (
    <TextInput
      style={[s.input, props.editable === false && { opacity: 0.6 }]}
      autoCapitalize="none"
      autoCorrect={false}
      placeholderTextColor={colors.muted}
      {...props}
    />
  );

  return (
    <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.center, { flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 380, gap: 10 }}>
          <Text style={{ fontSize: 56, textAlign: 'center' }}>🔒</Text>
          <Text style={[s.h1, { textAlign: 'center' }]}>MeetMe</Text>
          <Text style={[s.muted, { textAlign: 'center', marginBottom: 8 }]}>
            Private, end-to-end encrypted messenger
          </Text>

          <Text style={s.muted}>Server</Text>
          {input({ value: server, onChangeText: setServer, keyboardType: 'url' })}
          <Text style={s.muted}>{mode === 'login' ? 'Your ID' : 'Username'}</Text>
          {input({
            value: username,
            onChangeText: (t) => setUsername(t.toLowerCase()),
            placeholder: 'a-z, 0-9, _ .',
            editable: !mustChange,
          })}
          {mode === 'login' && (
            <>
              <Text style={s.muted}>Password</Text>
              {input({ value: password, onChangeText: setPassword, secureTextEntry: true, editable: !mustChange })}
            </>
          )}

          {mustChange && (
            <>
              <Text
                style={{
                  color: '#f5c46b',
                  backgroundColor: 'rgba(245,165,36,0.12)',
                  borderRadius: 8,
                  padding: 10,
                  marginTop: 6,
                }}
              >
                First login: choose your own password. After this, not even your admin knows it.
              </Text>
              {input({ value: newPw, onChangeText: setNewPw, secureTextEntry: true, placeholder: 'New password' })}
              {input({
                value: newPw2,
                onChangeText: setNewPw2,
                secureTextEntry: true,
                placeholder: 'Repeat new password',
              })}
            </>
          )}

          {error && <Text style={{ color: colors.danger }}>{error}</Text>}
          <Pressable
            style={[s.button, s.primary, (busy || !canSubmit) && { opacity: 0.5 }]}
            disabled={busy || !canSubmit}
            onPress={submit}
          >
            <Text style={s.buttonText}>
              {busy
                ? 'Creating your keys…'
                : mode === 'register'
                  ? 'Create account'
                  : mustChange
                    ? 'Save password & log in'
                    : 'Log in'}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setMustChange(false);
              setError(null);
            }}
          >
            <Text style={{ color: '#7da6ff', textAlign: 'center', marginTop: 10 }}>
              {mode === 'login' ? 'Admin: create the first account' : '← Back to log in'}
            </Text>
          </Pressable>
          <Text style={[s.muted, { textAlign: 'center', marginTop: 6 }]}>
            Your keys are created on this phone and never leave it.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
