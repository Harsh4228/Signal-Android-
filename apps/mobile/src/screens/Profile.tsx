import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Cake, Camera as CameraIcon, CircleDashed, Info, MessageSquare, Phone, RefreshCw, UserRound, Video, X } from 'lucide-react-native';
import { Camera, CameraType, type CameraApi } from 'react-native-camera-kit';
import { BIRTHDAY_RE, type OutgoingFile } from '@meetme/core';
import { calls, client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { Avatar, ChatAvatar, IconButton, Sheet, errorText, tints } from '../ui';
import { profilePhotoFrom } from '../photos';
import type { Route } from '../App';

type Toast = (m: string) => void;

/**
 * A person's picture, tappable like WhatsApp: with a status I haven't seen it plays the status; otherwise a
 * popup with their photo and buttons to message, call or see their details.
 */
export function AvatarTap({ user, size = 50, navigate, onToast }: { user: string; size?: number; navigate: (r: Route) => void; onToast: Toast }) {
  const [popup, setPopup] = useState(false);
  /** With a status: ask which one, like WhatsApp. */
  const [choose, setChoose] = useState(false);
  return (
    <>
      <Pressable
        hitSlop={4}
        accessibilityLabel={client.statusRingOf(user) ? 'View status or photo' : 'View photo'}
        onPress={() => (client.statusRingOf(user) ? setChoose(true) : setPopup(true))}
      >
        <ChatAvatar chatKey={user} size={size} />
      </Pressable>
      {choose && (
        <Sheet
          title={client.displayName(user)}
          onClose={() => setChoose(false)}
          actions={[
            { icon: CircleDashed, label: 'View status', onPress: () => navigate({ name: 'status-view', user, start: client.statusStartOf(user) }) },
            { icon: UserRound, label: 'View profile photo', onPress: () => setPopup(true) },
          ]}
        />
      )}
      {popup && <PhotoPopup user={user} navigate={navigate} onClose={() => setPopup(false)} onToast={onToast} />}
    </>
  );
}

/** WhatsApp's profile photo popup: the photo (tap for full size) and message / call / info buttons. */
export function PhotoPopup({ user, navigate, onClose, onToast }: { user: string; navigate: (r: Route) => void; onClose: () => void; onToast: Toast }) {
  const c = useClient();
  const photo = c.avatarOf(user);
  const [full, setFull] = useState(false);
  const go = (fn: () => void) => () => (onClose(), fn());
  const call = (video: boolean) => go(() => void calls.startCall(user, video).catch((e) => onToast(errorText(e))));
  const open = (name: 'chat' | 'info') => go(() => void client.addContact(user).then(() => navigate({ name, peer: user }), (e) => onToast(errorText(e))));
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.dim} onPress={onClose}>
        <Pressable style={styles.popup} onPress={() => {}}>
          <Pressable onPress={() => photo && setFull(true)} style={styles.popupImg}>
            {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Avatar name={user} size={150} />}
            <Text style={styles.popupName} numberOfLines={1}>
              {c.displayName(user)}
            </Text>
          </Pressable>
          <View style={styles.popupActions}>
            <IconButton icon={MessageSquare} label="Message" color={colors.accent} onPress={open('chat')} />
            <IconButton icon={Phone} label="Voice call" color={colors.accent} onPress={call(false)} />
            <IconButton icon={Video} label="Video call" color={colors.accent} onPress={call(true)} />
            <IconButton icon={Info} label="Details" color={colors.accent} onPress={open('info')} />
          </View>
        </Pressable>
      </Pressable>
      {full && !!photo && <FullPhoto uri={photo} title={c.displayName(user)} onClose={() => setFull(false)} />}
    </Modal>
  );
}

/** The whole photo on black, as large as the screen allows (not cut to a circle). */
export function FullPhoto({ uri, title, onClose }: { uri: string; title: string; onClose: () => void }) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" />
        <View style={[s.row, styles.fullHead]}>
          <IconButton icon={X} label="Close" color="#fff" onPress={onClose} />
          <Text style={{ color: '#fff', fontSize: 17, fontWeight: '600', flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

/** Profile details header: the full photo, edge to edge (not a circle, like WhatsApp); tap for full size. */
export function ProfileHero({ user }: { user: string }) {
  const c = useClient();
  const photo = c.avatarOf(user);
  const [full, setFull] = useState(false);
  if (!photo) return <ChatAvatar chatKey={user} size={96} />;
  return (
    <>
      <Pressable onPress={() => setFull(true)} style={styles.hero} accessibilityLabel="Show the photo full size">
        {/* The whole photo (not cut); a blurred copy of it fills the sides, like WhatsApp. */}
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={24} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} />
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      </Pressable>
      {full && <FullPhoto uri={photo} title={c.displayName(user)} onClose={() => setFull(false)} />}
    </>
  );
}

/** A tappable detail line: the mobile number opens the phone app, the email the mail app. */
export function DetailRow({ icon: Icon, value, label, link, tint }: { icon: typeof Phone; value: string; label: string; link?: string; tint?: keyof typeof tints }) {
  const fg = tint ? tints[tint][0] : colors.muted;
  const body = (
    <>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: tint ? tints[tint][1] : colors.surface2 }}>
        <Icon size={18} color={fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.text, { fontSize: 16 }, !!link && { color: tint ? fg : colors.accent, fontWeight: '600' }]} selectable={!link}>
          {value}
        </Text>
        <Text style={[s.muted, { fontSize: 13 }]}>{label}</Text>
      </View>
    </>
  );
  if (!link) return <View style={styles.detail}>{body}</View>;
  return (
    <Pressable
      style={({ pressed }) => [styles.detail, pressed && { backgroundColor: colors.hover }]}
      onPress={() => void Linking.openURL(link).catch(() => {})}
      accessibilityRole="link"
    >
      {body}
    </Pressable>
  );
}

export const telLink = (phone: string) => `tel:${phone.replace(/[^+\d]/g, '')}`;

/** Birth date as day / month / year boxes ("YYYY-MM-DD" out, '' when empty). Phones have no date field. */
export function BirthdayField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [y0 = '', m0 = '', d0 = ''] = value ? value.split('-') : [];
  const [d, setD] = useState(d0);
  const [m, setM] = useState(m0);
  const [y, setY] = useState(y0);
  const update = (nd: string, nm: string, ny: string) => {
    setD(nd);
    setM(nm);
    setY(ny);
    const v = `${ny}-${nm.padStart(2, '0')}-${nd.padStart(2, '0')}`;
    onChange(!nd && !nm && !ny ? '' : BIRTHDAY_RE.test(v) ? v : 'invalid');
  };
  const box = (val: string, set: (t: string) => void, ph: string, len: number) => (
    <TextInput
      style={[s.input, { width: len === 4 ? 76 : 54, textAlign: 'center' }]}
      value={val}
      onChangeText={(t) => set(t.replace(/\D/g, '').slice(0, len))}
      placeholder={ph}
      placeholderTextColor={colors.faint}
      keyboardType="number-pad"
      maxLength={len}
    />
  );
  return (
    <View style={[s.row, { gap: 8 }]}>
      <Cake size={20} color={colors.faint} />
      <Text style={[s.muted, { flex: 1 }]}>Birth date</Text>
      {box(d, (t) => update(t, m, y), 'DD', 2)}
      {box(m, (t) => update(d, t, y), 'MM', 2)}
      {box(y, (t) => update(d, m, t), 'YYYY', 4)}
    </View>
  );
}

/** Take a profile photo with the camera (front camera first, like a selfie). */
export function CameraCapture({ onPhoto, onClose, onError }: { onPhoto: (p: OutgoingFile) => void; onClose: () => void; onError: Toast }) {
  const camera = useRef<CameraApi>(null);
  const [front, setFront] = useState(true);
  const [busy, setBusy] = useState(false);
  const snap = async () => {
    setBusy(true);
    try {
      const shot = await camera.current!.capture();
      onPhoto(await profilePhotoFrom(shot.uri));
      onClose();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <Camera ref={camera} style={StyleSheet.absoluteFill} cameraType={front ? CameraType.Front : CameraType.Back} />
        {/* The part that becomes the photo: the middle square. */}
        <View pointerEvents="none" style={styles.square} />
        <View style={[s.row, styles.fullHead]}>
          <IconButton icon={X} label="Cancel" color="#fff" onPress={onClose} />
        </View>
        <View style={styles.shutterRow}>
          <IconButton icon={RefreshCw} label="Switch camera" color="#fff" onPress={() => setFront(!front)} />
          <Pressable style={styles.shutter} onPress={() => void snap()} disabled={busy} accessibilityLabel="Take photo">
            {busy ? <ActivityIndicator color="#000" /> : <CameraIcon size={28} color="#000" />}
          </Pressable>
          <View style={{ width: 44 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  popup: { width: 280, backgroundColor: colors.surface, borderRadius: 4, overflow: 'hidden' },
  popupImg: { width: 280, height: 280, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2 },
  popupName: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  popupActions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 2 },
  fullHead: { position: 'absolute', top: 36, left: 4, right: 12, gap: 4 },
  hero: { alignSelf: 'stretch', marginHorizontal: -16, marginTop: -16, aspectRatio: 1, maxHeight: 380, backgroundColor: '#000' },
  detail: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 12, paddingHorizontal: 4 },
  square: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    aspectRatio: 1,
    transform: [{ translateY: '-50%' }],
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.8)',
  },
  shutterRow: { position: 'absolute', bottom: 48, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  shutter: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
});
