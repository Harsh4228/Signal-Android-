import { useEffect, useRef, useState } from 'react';
import { BackHandler, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Camera, CameraType } from 'react-native-camera-kit';
import { ArrowLeft, Building2, CircleAlert, KeyRound, LockKeyhole, QrCode, ScanLine, Square, SquareCheck, X } from 'lucide-react-native';
import { MIN_PASSWORD_LENGTH, MustChangePasswordError, companyOf, makeUsername, normalizeServerUrl, parseInviteCode, shortId } from '@meetme/core';
import { DEFAULT_SERVER } from '../config';
import { client } from '../messenger';
import { colors, s } from '../theme';
import { Banner, Button, Field, IconButton, Logo, errorText } from '../ui';
import { loadRemembered, saveRemembered } from '../remember';

type Mode = 'join' | 'login' | 'company';

/**
 * New people scan the QR invite from their admin and only choose a password (the admin made their profile).
 * People who already have a password sign in with company code + ID + password. "Register your company" asks the
 * server owner for a new company (the very first one sets the server up).
 *
 * `moved`: this person was moved to another company; the new company's QR keeps their chats on this phone.
 */
export function RegisterScreen({ onDone, moved }: { onDone: () => void; moved?: boolean }) {
  const [mode, setMode] = useState<Mode>(moved ? 'join' : 'login');
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [editServer, setEditServer] = useState(false);
  const [company, setCompany] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [mustChange, setMustChange] = useState(false);
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const invite = mode === 'join' ? parseInviteCode(code) : null;
  const choosing = (mode === 'join' && !!invite) || mode === 'company' || mustChange;

  // Remember me: fill in what was saved the last time (signing out keeps it).
  useEffect(() => {
    void loadRemembered().then((r) => {
      if (!r || moved) return;
      if (r.server) setServer(r.server);
      setCompany(r.company);
      setUsername(r.id);
      setPassword(r.password);
    });
  }, [moved]);

  async function submit() {
    setError(null);
    if (choosing) {
      if (newPw.length < MIN_PASSWORD_LENGTH) return setError(`Password: at least ${MIN_PASSWORD_LENGTH} characters`);
      if (newPw !== newPw2) return setError('The two passwords are different');
    }
    setBusy(true);
    try {
      const url = normalizeServerUrl(server);
      const id = username.trim().toLowerCase();
      const co = company.trim().toLowerCase();
      if (mode === 'join') await client.join(code, newPw);
      else if (mode === 'company') await client.requestCompany(url, { companyCode: co, companyName, id, password: newPw });
      else await client.login(url, makeUsername(id, co), password, mustChange ? newPw : undefined);
      // The password that works from now on: the new one, if one was just chosen.
      const finalPw = mode === 'login' && !mustChange ? password : newPw;
      const who = mode === 'join' && invite ? invite.username : makeUsername(id, co);
      await saveRemembered(
        remember ? { server: mode === 'join' && invite ? invite.serverUrl : url, company: companyOf(who), id: shortId(who), password: finalPw } : null,
      );
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
    setNewPw('');
    setNewPw2('');
    setError(null);
  };

  const canSubmit =
    mode === 'join'
      ? !!invite && newPw.length > 0
      : mode === 'company'
        ? company.trim().length >= 2 && !!companyName.trim() && username.length >= 3 && newPw.length > 0
        : username.length >= 3 && password.length > 0 && (!mustChange || newPw.length > 0);

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

  const title = moved
    ? 'Moved to a new company'
    : mode === 'join'
      ? 'Join CellMate'
      : mode === 'login'
        ? 'Sign in to CellMate'
        : 'Register your company';
  const intro = moved
    ? 'Scan the QR code from your new admin and choose a password. Your chats and files stay on this phone.'
    : mode === 'join'
      ? 'Scan the QR code your admin gave you, then choose your password.'
      : mode === 'login'
        ? 'Sign in with your company code, your ID and your password.'
        : 'Ask for your own company. You can use it as soon as the server owner approves it.';

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 420, alignSelf: 'center', gap: 16 }}>
          <View style={{ alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Logo size={60} />
            <Text style={[s.h1, { marginTop: 8 }]}>{title}</Text>
            <Text style={[s.muted, { textAlign: 'center', fontSize: 14, lineHeight: 20 }]}>{intro}</Text>
          </View>

          {mode === 'join' ? (
            invite ? (
              <Banner kind="ok" icon={QrCode}>
                Joining as {shortId(invite.username)}. Choose your password: after this not even your admin knows it.
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
              {mode === 'company' && (
                <Field label="Company name" value={companyName} onChangeText={setCompanyName} placeholder="e.g. Acme Pvt Ltd" autoCapitalize="words" />
              )}
              <Field
                label="Company code"
                value={company}
                onChangeText={(t) => setCompany(t.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                placeholder="e.g. acme"
                maxLength={16}
                editable={!mustChange}
              />
              <Field
                label={mode === 'login' ? 'Your ID' : 'Your ID (you will be its admin)'}
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
              <Field label={mode === 'login' ? 'New password' : 'Choose a password'} value={newPw} onChangeText={setNewPw} secureTextEntry />
              <Field label="Confirm password" value={newPw2} onChangeText={setNewPw2} secureTextEntry />
              {mode === 'company' && (
                <Text style={[s.muted, { fontSize: 12.5, lineHeight: 18 }]}>
                  Remember this password: you need it with your company code and ID to sign in on another phone or computer.
                </Text>
              )}
            </>
          )}

          {(mode !== 'join' || invite) && (
            <Pressable
              onPress={() => setRemember((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: remember }}
              style={[s.row, { gap: 10 }]}
            >
              {remember ? <SquareCheck size={22} color={colors.accent} /> : <Square size={22} color={colors.faint} />}
              <Text style={[s.text, { flex: 1 }]}>Remember me on this phone</Text>
            </Pressable>
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
                    : mode === 'company'
                      ? 'Send request'
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

          {!moved && (
            <View style={{ gap: 2, alignItems: 'center' }}>
              {mode !== 'join' && <Link icon={QrCode} onPress={() => switchTo('join')} text="I have a QR invite" />}
              {mode !== 'login' && <Link icon={ArrowLeft} onPress={() => switchTo('login')} text="I already have a password: sign in" />}
              {mode !== 'company' && (
                <Link icon={Building2} onPress={() => switchTo('company')} text='Register your company' />
              )}
            </View>
          )}

          <View style={[s.divider, { marginTop: 4 }]} />
          {editServer ? (
            <Field label="Server address" value={server} onChangeText={setServer} keyboardType="url" placeholder={DEFAULT_SERVER} />
          ) : (
            // Long-press: use a different server (testing). Normal users never see a server address.
            <Pressable onLongPress={() => setEditServer(true)} delayLongPress={800} style={[s.row, { gap: 8, justifyContent: 'center' }]}>
              <LockKeyhole size={14} color={colors.muted} />
              <Text style={[s.muted, { fontSize: 12.5 }]}>Your keys are created on this phone and never leave it.</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Link({ text, onPress, icon: Icon }: { text: string; onPress: () => void; icon?: typeof ArrowLeft }) {
  return (
    <Pressable onPress={onPress} style={[s.row, { justifyContent: 'center', gap: 6, paddingVertical: 6 }]}>
      {Icon && <Icon size={15} color={colors.accent} />}
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
