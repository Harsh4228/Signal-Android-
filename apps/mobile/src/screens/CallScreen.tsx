import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { Lock, Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff, Volume1, Volume2, type LucideIcon } from 'lucide-react-native';
import { calls, client, setSpeaker, useCall, useSpeaker } from '../messenger';
import { colors, s } from '../theme';
import { Avatar } from '../ui';

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

function Btn({
  icon: Icon,
  label,
  onPress,
  kind = 'normal',
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  kind?: 'normal' | 'on' | 'hangup' | 'accept';
}) {
  const bg = kind === 'hangup' ? colors.danger : kind === 'accept' ? colors.online : kind === 'on' ? colors.text : colors.hover;
  const fg = kind === 'normal' ? colors.text2 : '#fff';
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Pressable onPress={onPress} accessibilityLabel={label} style={[styles.btn, { backgroundColor: bg }]}>
        <Icon size={24} color={fg} strokeWidth={2} />
      </Pressable>
      <Text style={[s.muted, { fontSize: 12 }]}>{label}</Text>
    </View>
  );
}

export function CallScreen() {
  const call = useCall();
  const speaker = useSpeaker();
  const duration = useDuration(call.startedAt);
  const hasVideo = call.video && !!call.remoteStream;
  const label =
    call.status === 'incoming'
      ? `Incoming ${call.video ? 'video' : 'voice'} call`
      : call.status === 'outgoing'
        ? 'Ringing…'
        : call.status === 'connecting'
          ? 'Connecting…'
          : duration;

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      {hasVideo ? (
        <RTCView streamURL={call.remoteStream!.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <View style={[s.center, { paddingBottom: 120 }]}>
          <Avatar name={call.peer ?? '?'} size={120} />
        </View>
      )}
      {call.video && call.localStream && !call.cameraOff && (
        <RTCView streamURL={call.localStream.toURL()} style={styles.local} objectFit="cover" mirror zOrder={1} />
      )}

      <View style={[styles.info, hasVideo && styles.infoOnVideo]}>
        <Text style={[s.h1, { fontSize: 22 }]}>{call.peer ? client.displayName(call.peer) : ''}</Text>
        <View style={[s.row, { gap: 5, marginTop: 4 }]}>
          <Lock size={13} color={colors.muted} />
          <Text style={s.muted}>{label}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        {call.status === 'incoming' ? (
          <>
            <Btn icon={PhoneOff} label="Decline" kind="hangup" onPress={() => void calls.reject()} />
            <Btn icon={call.video ? Video : Phone} label="Accept" kind="accept" onPress={() => void calls.accept()} />
          </>
        ) : (
          <>
            <Btn
              icon={call.muted ? MicOff : Mic}
              label={call.muted ? 'Unmute' : 'Mute'}
              kind={call.muted ? 'on' : 'normal'}
              onPress={() => calls.toggleMute()}
            />
            <Btn
              icon={speaker ? Volume2 : Volume1}
              label="Speaker"
              kind={speaker ? 'on' : 'normal'}
              onPress={() => setSpeaker(!speaker)}
            />
            {call.video && (
              <Btn
                icon={call.cameraOff ? VideoOff : Video}
                label="Camera"
                kind={call.cameraOff ? 'on' : 'normal'}
                onPress={() => calls.toggleCamera()}
              />
            )}
            {call.video && <Btn icon={SwitchCamera} label="Flip" onPress={() => calls.switchCamera()} />}
            <Btn icon={PhoneOff} label="End" kind="hangup" onPress={() => void calls.hangup()} />
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
    top: 24,
    width: 108,
    height: 156,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
  },
  info: { position: 'absolute', top: '52%', left: 0, right: 0, alignItems: 'center' },
  infoOnVideo: {
    top: 24,
    left: 16,
    right: undefined,
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
  },
  controls: {
    position: 'absolute',
    bottom: 32,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  btn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
