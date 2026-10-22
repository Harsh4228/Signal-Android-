import { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Camera, CameraType } from 'react-native-camera-kit';
import { ArrowLeft, CircleAlert, KeyRound, LockKeyhole, QrCode, ScanLine, X } from 'lucide-react-native';
import { MIN_PASSWORD_LENGTH, MustChangePasswordError, parseInviteCode } from '@meetme/core';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Banner, Button, Field, IconButton, Logo, errorText } from '../ui';

type Mode = 'join' | 'login' | 'register';

/**
 * New people scan the QR invite from their admin and only choose a password (the admin made their profile).
 * People who already have a password sign in. "Set up a new server" is for the admin's first account.
 */
export function RegisterScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('join');
  const [server, setServer] = useState('https://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invite = mode === 'join' ? parseInviteCode(code) : null;
  const choosing = (mode === 'join' && !!invite) || mustChange;

  async function submit() {
    setError(null);
    if (choosing) {
      if (newPw.length < MIN_PASSWORD_LENGTH) return setError(`Password: at least ${MIN_PASSWORD_LENGTH} characters`);
      if (newPw !== newPw2) return setError('The two passwords are different');
    }
    setBusy(true);
    try {
      if (mode === 'join') await client.join(code, newPw);
      else if (mode === 'register') await client.register(server, username);
      else await client.login(server, username, password, mustChange ? newPw : undefined);
      onDone();
    } catch (e) {
      if (e instanceof MustChangePasswordError) setMustChange(true);
      else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function startScan() {
    setError(null);
    if (Platform.OS === 'android') {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (r !== PermissionsAndroid.RESULTS.GRANTED) return setError('Camera permission is needed to scan the QR code');
    }
    setScanning(true);
  }

  const switchTo = (m: Mode) => {
    setMode(m);
    setMustChange(false);
    setError(null);
  };

  const canSubmit =
    mode === 'join'
      ? !!invite && newPw.length > 0
      : username.length >= 3 && (mode === 'register' || (password.length > 0 && (!mustChange || newPw.length > 0)));

  if (scanning) {
    return (
      <QrScanner
        onCode={(value) => {
          if (!parseInviteCode(value)) return false; // keep scanning: some other QR code
          setCode(value);
          setScanning(false);
          return true;
        }}
        onClose={() => setScanning(false)}
      />
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 16 }}>
          <View style={{ alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Logo size={60} />
            <Text style={[s.h1, { marginTop: 8 }]}>
              {mode === 'join' ? 'Join CellMate' : mode === 'login' ? 'Sign in to CellMate' : 'Set up CellMate'}
            </Text>
            <Text style={[s.muted, { textAlign: 'center', fontSize: 14, lineHeight: 20 }]}>
              {mode === 'join'
                ? 'Scan the QR code your admin gave you, then choose your password.'
                : mode === 'login'
                  ? 'Sign in with your ID and the password you chose.'
                  : 'Create the first administrator account for your server.'}
            </Text>
          </View>

          {mode === 'join' ? (
            invite ? (
              <Banner kind="ok" icon={QrCode}>
                Joining as {invite.username}. Choose your password: after this not even your admin knows it.
              </Banner>
            ) : (
              <>
                <Button variant="primary" icon={ScanLine} title="Scan QR code" onPress={() => void startScan()} />
                <Field label="Or paste the invite code" value={code} onChangeText={setCode} placeholder="cellmate://join?…" multiline />
                {!!code.trim() && (
                  <Banner kind="error" icon={CircleAlert}>
                    That isn't a CellMate invite code.
                  </Banner>
                )}
              </>
            )
          ) : (
            <>
              <Field label="Server address" value={server} onChangeText={setServer} keyboardType="url" placeholder="https://chat.yourcompany.com" />
              <Field
                label={mode === 'login' ? 'User ID' : 'Username'}
                value={username}
                onChangeText={(t) => setUsername(t.toLowerCase())}
                placeholder="e.g. ravi.k"
                editable={!mustChange}
              />
              {mode === 'login' && <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry editable={!mustChange} />}
              {mustChange && (
                <Banner kind="warn" icon={KeyRound}>
                  First sign-in: choose your own password. After this, not even your administrator knows it.
                </Banner>
              )}
            </>
          )}

          {choosing && (
            <>
              <Field label={mode === 'join' ? 'Choose a password' : 'New password'} value={newPw} onChangeText={setNewPw} secureTextEntry />
              <Field label="Confirm password" value={newPw2} onChangeText={setNewPw2} secureTextEntry />
            </>
          )}

          {error && (
            <Banner kind="error" icon={CircleAlert}>
              {error}
            </Banner>
          )}
          {(mode !== 'join' || invite) && (
            <Button
              variant="primary"
              title={
                busy
                  ? 'Creating your encryption keys…'
                  : mode === 'join'
                    ? 'Set password and join'
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
          )}
          {mode === 'join' && invite && <Button title="Scan a different QR" onPress={() => setCode('')} />}

          <View style={{ gap: 2, alignItems: 'center' }}>
            {mode !== 'join' && <Link icon onPress={() => switchTo('join')} text="I have a QR invite" />}
            {mode !== 'login' && <Link onPress={() => switchTo('login')} text="I already have a password: sign in" />}
            {mode !== 'register' && <Link onPress={() => switchTo('register')} text="Administrator? Set up a new server" />}
          </View>

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

function Link({ text, onPress, icon }: { text: string; onPress: () => void; icon?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.row, { justifyContent: 'center', gap: 6, paddingVertical: 6 }]}>
      {icon && <ArrowLeft size={15} color={colors.accent} />}
      <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 14 }}>{text}</Text>
    </Pressable>
  );
}

/** Full-screen camera that reads the QR invite. `onCode` returns true when it was a CellMate invite. */
function QrScanner({ onCode, onClose }: { onCode: (value: string) => boolean; onClose: () => void }) {
  const done = useRef(false);
  const [hint, setHint] = useState('Point the camera at the QR code from your admin');
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (onClose(), true));
    return () => sub.remove();
  }, [onClose]);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
      <Camera
        style={StyleSheet.absoluteFill}
        cameraType={CameraType.Back}
        scanBarcode
        onReadCode={(e: { nativeEvent: { codeStringValue: string } }) => {
          if (done.current) return;
          if (onCode(e.nativeEvent.codeStringValue)) done.current = true;
          else setHint("That's not a CellMate invite. Scan the QR code from your admin.");
        }}
      />
      <View style={styles.frame} pointerEvents="none" />
      <View style={[s.row, { padding: 8 }]}>
        <IconButton icon={X} label="Cancel" color="#fff" onPress={onClose} />
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    alignSelf: 'center',
    top: '28%',
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
  },
  hint: { position: 'absolute', bottom: 80, left: 24, right: 24, textAlign: 'center', color: '#fff', fontSize: 15, fontWeight: '500' },
});
