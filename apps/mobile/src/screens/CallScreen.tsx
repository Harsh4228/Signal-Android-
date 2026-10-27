import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import {
  ChevronDown,
  Lock,
  MessageSquareText,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  type LucideIcon,
} from 'lucide-react-native';
import { calls, client, setSpeaker, useCall, useSpeaker } from '../messenger';
import { Avatar, Sheet, errorText, useBack } from '../ui';

const BG = '#0b141a';
const PANEL = '#1f2c33';
const FG = '#e9edef';
const FG_MUTED = '#8696a0';
const RED = '#f15c6d';
const GREEN = '#00a884';

/** Quick answers when you can't pick up, like WhatsApp's "Decline with message". */
export const QUICK_REPLIES = ["Can't talk now. What's up?", "I'll call you right back.", "I'll call you later.", "Can't talk now. Call me later?"];

export function useDuration(startedAt: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return '';
  const sec = Math.floor((now - startedAt) / 1000);
  const h = Math.floor(sec / 3600);
  const mm = String(Math.floor((sec % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(sec % 60).padStart(2, '0')}`;
}

/** "Calling…", "Ringing…", "Reconnecting…" or the running time. */
export function useCallLabel() {
  const call = useCall();
  const duration = useDuration(call.startedAt);
  if (call.status === 'incoming') return `Incoming ${call.video ? 'video' : 'voice'} call`;
  if (call.status === 'outgoing') return call.ringing ? 'Ringing…' : 'Calling…';
  if (call.status === 'connecting') return 'Connecting…';
  return call.reconnecting ? 'Reconnecting…' : duration;
}

function RoundButton({
  icon: Icon,
  label,
  onPress,
  on,
  color,
  big,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  on?: boolean;
  color?: string;
  big?: boolean;
}) {
  const size = big ? 68 : 56;
  const bg = color ?? (on ? FG : 'rgba(255,255,255,0.12)');
  const fg = color ? '#fff' : on ? BG : FG;
  return (
    <View style={styles.btnWrap}>
      <Pressable
        onPress={onPress}
        accessibilityLabel={label}
        style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }, styles.btn, pressed && { opacity: 0.75 }]}
      >
        <Icon size={big ? 30 : 24} color={fg} strokeWidth={2} />
      </Pressable>
      <Text style={styles.btnLabel}>{label}</Text>
    </View>
  );
}

/** My own camera in a small corner window: drag it anywhere, tap it to swap with the big picture. */
function Pip({ streamURL, mirror, onPress }: { streamURL: string; mirror: boolean; onPress: () => void }) {
  const { width, height } = useWindowDimensions();
  const at = useRef({ x: width - 124, y: 72 });
  const pos = useRef(new Animated.ValueXY(at.current)).current;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
      onPanResponderMove: (_, g) => pos.setValue({ x: at.current.x + g.dx, y: at.current.y + g.dy }),
      onPanResponderRelease: (_, g) => {
        // Snap to the nearest side, like WhatsApp.
        const x = at.current.x + g.dx < width / 2 - 54 ? 16 : width - 124;
        const y = Math.min(Math.max(at.current.y + g.dy, 56), height - 320);
        at.current = { x, y };
        Animated.spring(pos, { toValue: at.current, useNativeDriver: false }).start();
      },
    }),
  ).current;
  return (
    <Animated.View style={[styles.pip, { left: pos.x, top: pos.y }]} {...pan.panHandlers}>
      <Pressable onPress={onPress} style={StyleSheet.absoluteFill}>
        <RTCView streamURL={streamURL} style={StyleSheet.absoluteFill} objectFit="cover" mirror={mirror} zOrder={1} />
      </Pressable>
    </Animated.View>
  );
}

export function CallScreen({ onMinimize }: { onMinimize: () => void }) {
  const call = useCall();
  const speaker = useSpeaker();
  const label = useCallLabel();
  const [controls, setControls] = useState(true);
  const [swapped, setSwapped] = useState(false);
  const [replying, setReplying] = useState(false);
  useBack(onMinimize);

  const name = call.peer ? client.displayName(call.peer) : '';
  const localVideo = call.video && !!call.localStream && !call.cameraOff && call.localStream.getVideoTracks().length > 0;
  const remoteVideo = call.video && !!call.remoteStream && !call.peerCameraOff && call.remoteStream.getVideoTracks().length > 0;
  const bigLocal = swapped && localVideo && remoteVideo;
  const big = bigLocal ? call.localStream : remoteVideo ? call.remoteStream : null;
  const small = bigLocal ? call.remoteStream : localVideo ? call.localStream : null;
  const showControls = controls || !big;

  // A video picture with nothing on top: tap it to show / hide the buttons.
  useEffect(() => {
    if (!big || !controls || call.status !== 'connected') return;
    const t = setTimeout(() => setControls(false), 5000);
    return () => clearTimeout(t);
  }, [big, controls, call.status]);

  async function declineWith(text: string) {
    const peer = call.peer;
    setReplying(false);
    await calls.reject();
    if (peer) await client.sendText(peer, text).catch((e) => console.warn('quick reply failed', errorText(e)));
  }

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BG }]}>
      {big ? (
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setControls((v) => !v)}>
          <RTCView streamURL={big.toURL()} style={StyleSheet.absoluteFill} objectFit="cover" mirror={bigLocal} />
        </Pressable>
      ) : (
        <View style={styles.center}>
          <Avatar name={call.peer ?? '?'} size={128} />
        </View>
      )}
      {small && <Pip streamURL={small.toURL()} mirror={!bigLocal} onPress={() => setSwapped((v) => !v)} />}

      {showControls && (
        <View style={styles.top} pointerEvents="box-none">
          <Pressable onPress={onMinimize} accessibilityLabel="Back to chats" hitSlop={12} style={styles.topBtn}>
            <ChevronDown size={26} color={FG} />
          </Pressable>
          <View style={styles.e2e}>
            <Lock size={12} color={FG_MUTED} />
            <Text style={{ color: FG_MUTED, fontSize: 12 }}>End-to-end encrypted</Text>
          </View>
          {localVideo && call.status !== 'incoming' ? (
            <Pressable onPress={() => calls.switchCamera()} accessibilityLabel="Flip camera" hitSlop={12} style={styles.topBtn}>
              <SwitchCamera size={22} color={FG} />
            </Pressable>
          ) : (
            <View style={styles.topBtn} />
          )}
        </View>
      )}

      {(showControls || !big) && (
        <View style={[styles.info, big && styles.infoOnVideo]} pointerEvents="none">
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.status, call.reconnecting && { color: '#ffd279' }]}>{label}</Text>
          {call.peerMuted && call.status === 'connected' && (
            <View style={styles.chip}>
              <MicOff size={13} color={FG} />
              <Text style={{ color: FG, fontSize: 12 }}>{name.split(' ')[0]} muted</Text>
            </View>
          )}
        </View>
      )}

      {call.status === 'incoming' ? (
        <View style={styles.incoming}>
          <Pressable onPress={() => setReplying(true)} style={styles.message} accessibilityLabel="Decline with message">
            <MessageSquareText size={18} color={FG} />
            <Text style={{ color: FG, fontSize: 14 }}>Message</Text>
          </Pressable>
          <View style={styles.incomingRow}>
            <RoundButton big icon={PhoneOff} label="Decline" color={RED} onPress={() => void calls.reject()} />
            <RoundButton big icon={call.video ? Video : Phone} label="Accept" color={GREEN} onPress={() => void calls.accept()} />
          </View>
        </View>
      ) : (
        showControls && (
          <View style={styles.controls}>
            <RoundButton icon={Volume2} label="Speaker" on={speaker} onPress={() => setSpeaker(!speaker)} />
            <RoundButton
              icon={localVideo ? Video : VideoOff}
              label="Camera"
              on={localVideo}
              onPress={() => calls.toggleCamera()}
            />
            <RoundButton icon={call.muted ? MicOff : Mic} label={call.muted ? 'Unmute' : 'Mute'} on={call.muted} onPress={() => calls.toggleMute()} />
            <RoundButton icon={PhoneOff} label="End" color={RED} onPress={() => void calls.hangup()} />
          </View>
        )
      )}

      {replying && (
        <Sheet
          title={`Reply to ${name}`}
          onClose={() => setReplying(false)}
          actions={QUICK_REPLIES.map((text) => ({ icon: MessageSquareText, label: text, onPress: () => void declineWith(text) }))}
        />
      )}
    </View>
  );
}

/** Thin green bar over the app while a call runs in the background ("Tap to return to call"). */
export function CallBar({ onPress }: { onPress: () => void }) {
  const call = useCall();
  const label = useCallLabel();
  const name = call.peer ? client.displayName(call.peer) : '';
  return (
    <Pressable onPress={onPress} style={styles.bar} accessibilityLabel="Return to call">
      {call.video ? <Video size={16} color="#fff" /> : <Phone size={16} color="#fff" />}
      <Text style={{ color: '#fff', fontWeight: '600', flex: 1 }} numberOfLines={1}>
        {call.status === 'incoming' ? `${name} is calling · tap to answer` : `${name} · ${label} · tap to return`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 140 },
  top: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  e2e: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  info: { position: 'absolute', top: '56%', left: 24, right: 24, alignItems: 'center', gap: 6 },
  infoOnVideo: { top: 60, backgroundColor: 'rgba(11,20,26,0.55)', borderRadius: 14, paddingVertical: 8, alignSelf: 'center' },
  name: { color: FG, fontSize: 26, fontWeight: '600' },
  status: { color: FG_MUTED, fontSize: 15 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  pip: { position: 'absolute', width: 108, height: 160, borderRadius: 14, overflow: 'hidden', backgroundColor: PANEL, elevation: 6 },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingTop: 18,
    paddingBottom: 28,
    backgroundColor: PANEL,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  incoming: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 28 },
  incomingRow: { flexDirection: 'row', justifyContent: 'space-around', alignSelf: 'stretch' },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  btnWrap: { alignItems: 'center', gap: 6, minWidth: 64 },
  btn: { alignItems: 'center', justifyContent: 'center' },
  btnLabel: { color: FG_MUTED, fontSize: 12 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: GREEN,
  },
});
