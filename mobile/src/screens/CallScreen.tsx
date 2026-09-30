import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { calls, useCall } from '../messenger';
import { colors, s } from '../theme';

function useDuration(startedAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return '';
  const sec = Math.floor((now - startedAt) / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function Btn({ label, onPress, color }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.btn, color ? { backgroundColor: color } : null]}>
      <Text style={{ fontSize: 24, color: colors.text }}>{label}</Text>
    </Pressable>
  );
}

export function CallScreen() {
  const call = useCall();
  const duration = useDuration(call.startedAt);
  const label =
    call.status === 'incoming'
      ? `Incoming ${call.video ? 'video' : 'voice'} call`
      : call.status === 'outgoing'
        ? 'Ringing…'
        : call.status === 'connecting'
          ? 'Connecting…'
          : duration;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#05090c' }]}>
      {call.video && call.remoteStream ? (
        <RTCView streamURL={call.remoteStream.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <View style={s.center}>
          <View style={[s.avatar, { width: 120, height: 120, borderRadius: 60 }]}>
            <Text style={[s.avatarText, { fontSize: 48 }]}>{call.peer?.[0]?.toUpperCase()}</Text>
          </View>
        </View>
      )}
      {call.video && call.localStream && !call.cameraOff && (
        <RTCView streamURL={call.localStream.toURL()} style={styles.local} objectFit="cover" mirror zOrder={1} />
      )}

      <View style={styles.info}>
        <Text style={[s.text, { fontSize: 22, fontWeight: '700' }]}>{call.peer}</Text>
        <Text style={s.muted}>🔒 {label}</Text>
      </View>

      <View style={styles.controls}>
        {call.status === 'incoming' ? (
          <>
            <Btn label="✕" color={colors.danger} onPress={() => void calls.reject()} />
            <Btn label="✆" color={colors.ok} onPress={() => void calls.accept()} />
          </>
        ) : (
          <>
            <Btn label={call.muted ? '🔇' : '🎤'} onPress={() => calls.toggleMute()} />
            {call.video && <Btn label={call.cameraOff ? '🚫' : '📷'} onPress={() => calls.toggleCamera()} />}
            {call.video && <Btn label="🔄" onPress={() => calls.switchCamera()} />}
            <Btn label="✕" color={colors.danger} onPress={() => void calls.hangup()} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  local: {
    position: 'absolute',
    right: 16,
    bottom: 130,
    width: 110,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
  },
  info: { position: 'absolute', top: 40, left: 0, right: 0, alignItems: 'center' },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
  },
  btn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
