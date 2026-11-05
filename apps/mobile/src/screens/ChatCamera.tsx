import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, Modal, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, CameraType, type CameraApi } from 'react-native-camera-kit';
import { Eye, RefreshCw, SendHorizontal, X, Zap, ZapOff } from 'lucide-react-native';
import type { OutgoingFile } from '@meetme/core';
import { photoForChat } from '../photos';
import { IconButton, errorText } from '../ui';

type Flash = 'auto' | 'on' | 'off';
const NEXT_FLASH: Record<Flash, Flash> = { auto: 'on', on: 'off', off: 'auto' };

/**
 * Like WhatsApp's camera in a chat: take a photo, see it, add a caption (and view once), send. The photo goes
 * end-to-end encrypted like any other; nothing is saved to the phone's gallery.
 */
export function ChatCamera({
  initialCaption,
  allowViewOnce,
  onSend,
  onClose,
  onError,
}: {
  initialCaption: string;
  allowViewOnce: boolean;
  onSend: (file: OutgoingFile, caption: string, viewOnce: boolean) => void;
  onClose: () => void;
  onError: (m: string) => void;
}) {
  const camera = useRef<CameraApi>(null);
  const insets = useSafeAreaInsets();
  const top = { top: insets.top + 8 };
  const [allowed, setAllowed] = useState(Platform.OS !== 'android');
  const [front, setFront] = useState(false);
  const [flash, setFlash] = useState<Flash>('auto');
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [caption, setCaption] = useState(initialCaption);
  const [viewOnce, setViewOnce] = useState(false);

  // Android asks for the camera the first time (iPhone asks by itself).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA).then((r) => {
      if (r === PermissionsAndroid.RESULTS.GRANTED) setAllowed(true);
      else {
        onError('CellMate needs the camera to take a photo (allow it in the phone settings)');
        onClose();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back: from the preview back to the camera, from the camera out.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (shot) setShot(null);
      else onClose();
      return true;
    });
    return () => sub.remove();
  }, [shot, onClose]);

  async function snap() {
    if (!camera.current || busy) return;
    setBusy(true);
    try {
      const r = await camera.current.capture();
      setShot(r.uri);
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!shot) return;
    setBusy(true);
    try {
      onSend(await photoForChat(shot), caption.trim(), viewOnce);
      onClose();
    } catch (e) {
      onError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={() => (shot ? setShot(null) : onClose())} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.screen}>
        {shot ? (
          <>
            <Image source={{ uri: shot }} style={StyleSheet.absoluteFill} resizeMode="contain" />
            <View style={[styles.top, top]}>
              <IconButton icon={X} label="Take again" color="#fff" onPress={() => setShot(null)} />
              <View style={{ flex: 1 }} />
              {allowViewOnce && (
                <Pressable onPress={() => setViewOnce(!viewOnce)} style={[styles.pill, viewOnce && styles.pillOn]} accessibilityLabel="View once">
                  <Eye size={18} color={viewOnce ? '#000' : '#fff'} />
                  <Text style={{ color: viewOnce ? '#000' : '#fff', fontWeight: '600', fontSize: 13 }}>View once</Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.bottom, { bottom: insets.bottom + 16 }]}>
              <TextInput
                style={styles.caption}
                value={caption}
                onChangeText={setCaption}
                placeholder="Add a caption…"
                placeholderTextColor="#aaa"
                multiline
                autoCorrect={false}
                spellCheck={false}
              />
              <Pressable style={styles.send} onPress={() => void send()} disabled={busy} accessibilityLabel="Send">
                {busy ? <ActivityIndicator color="#fff" /> : <SendHorizontal size={22} color="#fff" />}
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {allowed && (
              <Camera ref={camera} style={StyleSheet.absoluteFill} cameraType={front ? CameraType.Front : CameraType.Back} flashMode={flash} zoomMode="on" focusMode="on" />
            )}
            <View style={[styles.top, top]}>
              <IconButton icon={X} label="Close" color="#fff" onPress={onClose} />
              <View style={{ flex: 1 }} />
              {!front && (
                <Pressable onPress={() => setFlash(NEXT_FLASH[flash])} style={styles.pill} accessibilityLabel={`Flash ${flash}`}>
                  {flash === 'off' ? <ZapOff size={18} color="#fff" /> : <Zap size={18} color="#fff" fill={flash === 'on' ? '#fff' : 'none'} />}
                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>{flash === 'auto' ? 'Auto' : flash === 'on' ? 'On' : 'Off'}</Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.shutterRow, { bottom: insets.bottom + 32 }]}>
              <View style={{ width: 48 }} />
              <Pressable style={styles.shutter} onPress={() => void snap()} disabled={busy || !allowed} accessibilityLabel="Take photo">
                {busy ? <ActivityIndicator color="#000" /> : <View style={styles.shutterInner} />}
              </Pressable>
              <IconButton icon={RefreshCw} label="Switch camera" color="#fff" onPress={() => setFront(!front)} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 36, left: 4, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.45)' },
  pillOn: { backgroundColor: '#fff' },
  shutterRow: { position: 'absolute', bottom: 48, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  bottom: { position: 'absolute', bottom: 28, left: 12, right: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  caption: { flex: 1, maxHeight: 120, color: '#fff', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center' },
});
