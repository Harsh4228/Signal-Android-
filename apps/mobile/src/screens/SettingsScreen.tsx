import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Ban, Building2, Camera, ChevronRight, CircleAlert, CircleCheck, CloudUpload, FileText, Lock, LogOut, ShieldCheck, Trash2 } from 'lucide-react-native';
import { AVATAR_MIMES, birthdayText, MAX_ABOUT, MAX_EMAIL, MAX_PHONE, MIN_PASSWORD_LENGTH, shortId } from '@meetme/core';
import { pickFile } from '../files';
import { appLock, client, useClient, useLock } from '../messenger';
import { resetPush } from '../push';
import { chooseTheme, colors, s, themeChoice, type ThemeChoice } from '../theme';
import { Avatar, Banner, Button, Field, Header, Row, errorText } from '../ui';
import type { Route } from '../App';
import { BlockedScreen, requestDeletion } from './Safety';
import { BirthdayField, ProfileHero } from './Profile';
import { LEGAL_BASE } from '../config';

const SECURITY = [
  'End-to-end encryption with the Signal protocol (X3DH + Double Ratchet)',
  'Chats, photos and documents are kept encrypted inside the app; the chat backup on the server is locked with your password',
  'Keys stored only in the iOS Keychain / Android Keystore, excluded from backups',
  'Screenshots, screen recording and app-switcher previews are blocked',
  'Files can be saved to your phone, copied or screenshotted only if your admin allows it',
  'Calls use WebRTC with keys exchanged over the encrypted channel',
];

/** Pick a photo and make it my profile photo (JPEG / PNG / WebP up to 2 MB). */
async function choosePhoto() {
  try {
    const f = await pickFile('photo');
    if (!f) return;
    if (!(AVATAR_MIMES as readonly string[]).includes(f.mime)) {
      throw new Error('Please choose a JPEG or PNG photo (on iPhone: share it as "Most Compatible").');
    }
    await client.setMyAvatar({ mime: f.mime, data: f.data });
  } catch (e) {
    Alert.alert('Profile photo', errorText(e));
  }
}

function photoOptions(hasPhoto: boolean) {
  if (!hasPhoto) return void choosePhoto();
  Alert.alert('Profile photo', 'Everyone at your company can see it. It is not end-to-end encrypted.', [
    { text: 'Choose new photo', onPress: () => void choosePhoto() },
    {
      text: 'Remove photo',
      style: 'destructive',
      onPress: () => client.removeMyAvatar().catch((e) => Alert.alert('Profile photo', errorText(e))),
    },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

/**
 * My mobile number and email; colleagues see them under my name. On a company server the admin set them and only
 * the admin can change them (shown read-only); admins edit their own here.
 */
function ContactSettings({ editable }: { editable: boolean }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    client
      .getMyContactInfo()
      .then((c) => {
        setName(c.name);
        setPhone(c.phone);
        setEmail(c.email);
      })
      .catch(() => setPhone(''));
  }, []);
  if (!editable) {
    return (
      <View style={[s.card, { padding: 16, gap: 10 }]}>
        {(
          [
            ['Name', name],
            ['Mobile', phone],
            ['Email', email],
          ] as const
        ).map(([label, value]) => (
          <View key={label}>
            <Text style={[s.muted, { fontSize: 12 }]}>{label}</Text>
            <Text style={s.text}>{value || '—'}</Text>
          </View>
        ))}
        <Text style={[s.muted, { fontSize: 12, lineHeight: 18 }]}>
          Your name, photo, mobile and email are set by your admin. Ask your admin if something needs to change.
        </Text>
      </View>
    );
  }
  async function save() {
    setBusy(true);
    try {
      await client.setMyContactInfo(phone ?? '', email);
      setMsg({ ok: true, text: 'Saved' });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[s.card, { padding: 16, gap: 10 }]}>
      <Field value={phone ?? ''} onChangeText={setPhone} placeholder="Mobile number, e.g. +91 98765 43210" keyboardType="phone-pad" maxLength={MAX_PHONE} editable={phone !== null} />
      <Field value={email} onChangeText={setEmail} placeholder="Work email" keyboardType="email-address" maxLength={MAX_EMAIL} editable={phone !== null} />
      <Text style={[s.muted, { fontSize: 12 }]}>Shown to your colleagues under your name, with your department.</Text>
      {msg && (
        <Banner kind={msg.ok ? 'ok' : 'error'} icon={msg.ok ? CircleCheck : CircleAlert}>
          {msg.text}
        </Banner>
      )}
      <Button title="Save" busy={busy} disabled={phone === null} onPress={save} />
    </View>
  );
}

export function SettingsScreen({ navigate }: { navigate: (r: Route) => void }) {
  const c = useClient();
  const lock = useLock();
  // Profiles are set by the admin; only admins (or anyone on a server without admins) edit their own.
  const canEditProfile = c.isAdmin || c.admins.length === 0;
  // The profile photo: also with the admin's "Change own profile photo" permission.
  const canEditPhoto = canEditProfile || c.can('profilePhoto');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showBlocked, setShowBlocked] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

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
          resetPush();
          void client.logout().then(() => appLock.load());
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
          client
            .deleteAccount()
            .then(() => {
              navigate({ name: 'list' });
              resetPush();
              return appLock.load();
            })
            .catch((e) => Alert.alert('Delete account', errorText(e)));
        },
      },
    ]);

  return (
    <View style={s.fill}>
      <Header title="Settings" onBack={() => navigate({ name: 'list' })} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {!!c.account && !!c.avatarOf(c.account.username) && (
          <View style={{ marginBottom: 12 }}>
            <ProfileHero user={c.account.username} />
          </View>
        )}
        <View style={[s.card, s.row, { padding: 16, gap: 14 }]}>
          <Pressable
            onPress={() => canEditPhoto && photoOptions(!!c.account && !!c.avatarOf(c.account.username))}
            disabled={!canEditPhoto}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
          >
            <Avatar name={c.account?.username ?? '?'} size={52} />
            {canEditPhoto && (
            <View
              style={{
                position: 'absolute',
                right: -2,
                bottom: -2,
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: colors.accent,
                borderWidth: 2,
                borderColor: colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Camera size={11} color="#fff" />
            </View>
            )}
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[s.title, { fontSize: 18 }]}>{c.account ? c.displayName(c.account.username) : ''}</Text>
            <Text style={s.muted} numberOfLines={1}>
              @{c.account ? shortId(c.account.username) : ''}
              {c.company ? ` · ${c.company.name} (${c.company.code})` : ` · ${c.account?.serverUrl ?? ''}`}
            </Text>
            {canEditPhoto && (
              <Text style={{ color: colors.accent, fontSize: 13, marginTop: 2 }}>
                {c.account && c.avatarOf(c.account.username) ? 'Tap photo to change' : 'Tap to add a profile photo'}
              </Text>
            )}
          </View>
        </View>

        <Text style={s.section}>{canEditProfile ? 'Mobile number & email' : 'My profile'}</Text>
        <ContactSettings editable={canEditProfile} />

        <Text style={s.section}>Privacy</Text>
        <View style={[s.card, { padding: 4 }]}>
          <Row
            icon={Lock}
            title="App lock"
            subtitle={lock.enabled ? 'On' : 'Off. Require a PIN to open CellMate'}
            onPress={() => navigate({ name: 'applock' })}
            right={<ChevronRight size={18} color={colors.faint} />}
          />
          <Row
            icon={Ban}
            title="Blocked"
            subtitle={c.blocked.length ? `${c.blocked.length} blocked` : 'Nobody'}
            onPress={() => setShowBlocked(true)}
            right={<ChevronRight size={18} color={colors.faint} />}
          />
        </View>
        <PrivacySettings />

        <Text style={s.section}>Appearance</Text>
        <ThemeSettings />

        {c.isSuper && (
          <>
            <Text style={s.section}>Server owner</Text>
            <View style={[s.card, { padding: 4 }]}>
              <Row
                icon={Building2}
                title="Companies"
                subtitle="Approve companies, add new ones, move people. Opens in your browser; sign in with company code, ID and password."
                onPress={() => c.account && void Linking.openURL(`${c.account.serverUrl}/super`)}
                right={<ChevronRight size={18} color={colors.faint} />}
              />
            </View>
          </>
        )}

        <Text style={s.section}>Chat backup</Text>
        <BackupSettings />

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
          {c.canDeleteOwnAccount ? (
            <Row icon={Trash2} title="Delete account" subtitle="Wipes all keys from this phone" danger onPress={wipe} />
          ) : (
            <Row icon={Trash2} title="Delete account" subtitle="Ask your admin to delete your account" danger onPress={() => requestDeletion(setToast)} />
          )}
        </View>

        <Text style={s.section}>About</Text>
        <View style={[s.card, { padding: 4 }]}>
          <Row icon={ShieldCheck} title="Privacy policy" onPress={() => void Linking.openURL(`${LEGAL_BASE}/privacy`)} right={<ChevronRight size={18} color={colors.faint} />} />
          <Row icon={FileText} title="Terms of use" onPress={() => void Linking.openURL(`${LEGAL_BASE}/terms`)} right={<ChevronRight size={18} color={colors.faint} />} />
        </View>
      </ScrollView>
      {toast && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 24 }}>
          <Banner kind="ok" icon={CircleCheck}>
            {toast}
          </Banner>
        </View>
      )}
      {showBlocked && <BlockedScreen onClose={() => setShowBlocked(false)} onToast={setToast} />}
    </View>
  );
}

/**
 * The end-to-end encrypted chat backup: when it last ran, "Back up now", and an older backup locked with a
 * previous password (after the admin reset it) waiting to be opened.
 */
function BackupSettings() {
  const c = useClient();
  const [old, setOld] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={[s.card, { padding: 16, gap: 10 }]}>
      <Text style={[s.muted, { lineHeight: 19 }]}>
        Your chats are backed up to the server, encrypted with your password: when you log in on another phone or PC, they come
        back. Nobody else, not even the admin or the server, can read them.
      </Text>
      <Text style={s.text}>Last backup: {c.lastBackupAt ? new Date(c.lastBackupAt).toLocaleString() : 'not yet'}</Text>
      {c.backupLocked ? (
        <>
          <Banner kind="warn" icon={CircleAlert}>
            You have older chats in a backup made with your previous password. Enter that password to bring them back.
          </Banner>
          <Field value={old} onChangeText={setOld} placeholder="Previous password" secureTextEntry />
          <Button
            variant="primary"
            title="Restore older chats"
            busy={busy}
            disabled={!old}
            onPress={() => void run(async () => `Restored ${await client.restoreOldBackup(old)} messages`)}
          />
          <Button
            title="Don't restore, start a new backup"
            onPress={() =>
              Alert.alert('Start a new backup', 'The older chats will be gone for good. Continue?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Start new', style: 'destructive', onPress: () => void run(async () => (await client.discardOldBackup(), 'New backup started')) },
              ])
            }
          />
        </>
      ) : (
        <Button title="Back up now" icon={CloudUpload} busy={busy} onPress={() => void run(async () => (await client.flushHistory(), 'Backed up'))} />
      )}
      {msg && (
        <Banner kind={msg.ok ? 'ok' : 'error'} icon={msg.ok ? CircleCheck : CircleAlert}>
          {msg.text}
        </Banner>
      )}
    </View>
  );
}
/** Like WhatsApp: my About line, read receipts and last seen. */
function PrivacySettings() {
  const c = useClient();
  const [about, setAbout] = useState(c.about);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setAbout(c.about), [c.about]);
  const [birthday, setBirthday] = useState(c.birthday);
  useEffect(() => setBirthday(c.birthday), [c.birthday]);
  const save = (fn: () => Promise<void>, done: string) =>
    void fn().then(
      () => setMsg(done),
      (e) => setMsg(errorText(e)),
    );
  const toggle = (title: string, hint: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={[s.row, { gap: 12, paddingHorizontal: 12, paddingVertical: 10 }]}>
      <View style={{ flex: 1 }}>
        <Text style={s.textStrong}>{title}</Text>
        <Text style={[s.muted, { marginTop: 2, lineHeight: 18 }]}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.accent, false: colors.lineStrong }} thumbColor="#fff" />
    </View>
  );
  return (
    <View style={[s.card, { padding: 4, marginTop: 10, gap: 2 }]}>
      <View style={{ padding: 12, gap: 8 }}>
        <Text style={s.textStrong}>About</Text>
        <Field value={about} onChangeText={setAbout} placeholder="e.g. At the Pune office" maxLength={MAX_ABOUT} autoCapitalize="sentences" />
        {about.trim() !== c.about && <Button title="Save About" onPress={() => save(() => client.setPrivacy({ about }), 'About saved')} />}
      </View>
      {/* My birth date: colleagues see it on my profile. */}
      <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 8 }}>
        <BirthdayField key={c.birthday} value={birthday} onChange={setBirthday} />
        {!!c.birthday && birthday === c.birthday && <Text style={s.muted}>{birthdayText(c.birthday)} · colleagues see it on your profile</Text>}
        {birthday !== c.birthday && (
          <Button
            title="Save birth date"
            onPress={() =>
              birthday === 'invalid'
                ? setMsg('Birth date: enter day, month and year (e.g. 21 08 1994)')
                : save(() => client.setPrivacy({ birthday }), birthday ? 'Birth date saved' : 'Birth date removed')
            }
          />
        )}
      </View>
      {toggle('Read receipts', 'When off, people don\'t see when you read their messages, and you don\'t see theirs.', c.privacy.readReceipts, (v) =>
        save(() => client.setReadReceipts(v), v ? 'Read receipts on' : 'Read receipts off'),
      )}
      {toggle('Hide last seen & online', 'Nobody sees when you were last online, and you don\'t see theirs.', c.hideLastSeen, (v) =>
        save(() => client.setPrivacy({ hideLastSeen: v }), v ? 'Last seen hidden' : 'Last seen shown'),
      )}
      {msg && <Text style={[s.muted, { padding: 12, paddingTop: 0 }]}>{msg}</Text>}
    </View>
  );
}
/** Light, dark, or like the phone. Changing it restarts CellMate so every screen gets the new colours. */
function ThemeSettings() {
  const pick = (t: ThemeChoice) => {
    if (t === themeChoice) return;
    Alert.alert('Change appearance', 'CellMate restarts to use the new colours. Your chats stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restart',
        // Chats are saved and backed up first, so nothing is lost by the restart.
        onPress: () => void client.flushHistory().catch(() => {}).then(() => chooseTheme(t)).catch((e) => Alert.alert('Appearance', errorText(e))),
      },
    ]);
  };
  return (
    <View style={[s.card, s.row, { padding: 4, gap: 4 }]}>
      {(
        [
          ['system', 'Like phone'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ] as [ThemeChoice, string][]
      ).map(([t, label]) => (
        <Pressable
          key={t}
          onPress={() => pick(t)}
          style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: themeChoice === t ? colors.accentSoft : 'transparent' }}
        >
          <Text style={{ color: themeChoice === t ? colors.accentText : colors.text2, fontWeight: '600' }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}