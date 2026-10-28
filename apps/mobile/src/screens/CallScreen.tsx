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

const PIP_W = 108;
const PIP_H = 160;
const EDGE = 12;
/** Space the top bar (and the name over the video) and the bottom buttons take while they are shown. */
const TOP_SPACE = 132;
const BOTTOM_SPACE = 132;

/**
 * The small picture: drag it anywhere on the screen, tap it to swap with the big one. It never sits under the top
 * bar or the buttons: when they slide in, it moves out of their way (like WhatsApp).
 */
function Pip({ streamURL, mirror, onPress, controls }: { streamURL: string; mirror: boolean; onPress: () => void; controls: boolean }) {
  const { width, height } = useWindowDimensions();
  const limits = useRef({ top: TOP_SPACE, bottom: height - BOTTOM_SPACE - PIP_H, right: width - PIP_W - EDGE });
  limits.current = {
    top: controls ? TOP_SPACE : EDGE,
    bottom: height - (controls ? BOTTOM_SPACE : EDGE) - PIP_H,
    right: width - PIP_W - EDGE,
  };
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(Math.max(p.x, EDGE), limits.current.right),
    y: Math.min(Math.max(p.y, limits.current.top), Math.max(limits.current.top, limits.current.bottom)),
  });
  const at = useRef(clamp({ x: width - PIP_W - EDGE, y: TOP_SPACE }));
  const pos = useRef(new Animated.ValueXY(at.current)).current;
  const moveTo = (p: { x: number; y: number }) => {
    at.current = clamp(p);
    Animated.spring(pos, { toValue: at.current, useNativeDriver: false, friction: 8 }).start();
  };
  // Controls in or out, or the phone turned: keep it inside the free area.
  useEffect(() => moveTo(at.current), [controls, width, height]);
  const pan = useRef(
    PanResponder.create({
      // Capture: a drag that starts on the picture moves it (the tap-to-swap button would otherwise keep the touch).
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 6,
      onPanResponderMove: (_, g) => pos.setValue({ x: at.current.x + g.dx, y: at.current.y + g.dy }),
      onPanResponderRelease: (_, g) => moveTo({ x: at.current.x + g.dx, y: at.current.y + g.dy }),
      onPanResponderTerminate: () => moveTo(at.current),
    }),
  ).current;
  return (
    <Animated.View style={[styles.pip, { left: pos.x, top: pos.y }]} {...pan.panHandlers}>
      <Pressable onPress={onPress} style={StyleSheet.absoluteFill} accessibilityLabel="Swap pictures">
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
  // The bars slide in and out instead of jumping.
  const shown = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(shown, { toValue: showControls ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [showControls, shown]);
  const slide = (distance: number) => ({
    opacity: shown,
    transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  });

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
      {small && <Pip streamURL={small.toURL()} mirror={!bigLocal} onPress={() => setSwapped((v) => !v)} controls={showControls} />}

      {(
        <Animated.View style={[styles.top, slide(-80)]} pointerEvents={showControls ? 'box-none' : 'none'}>
          <Pressable onPress={onMinimize} accessibilityLabel="Back to chats" hitSlop={12} style={styles.topBtn}>
            <ChevronDown size={26} color={FG} />
          </Pressable>
          <View style={styles.e2e}>
            <Lock size={12} color={FG_MUTED} />
            <Text style={{ color: FG_MUTED, fontSize: 12 }}>End-to-end encrypted</Text>
          </View>
          <View style={styles.topBtn} />
        </Animated.View>
      )}

      {(
        <Animated.View style={[styles.info, big && styles.infoOnVideo, big ? slide(-80) : null]} pointerEvents="none">
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
        </Animated.View>
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
        (
          <Animated.View style={[styles.controls, slide(140)]} pointerEvents={showControls ? 'auto' : 'none'}>
            <RoundButton icon={Volume2} label="Speaker" on={speaker} onPress={() => setSpeaker(!speaker)} />
            {(call.video || (call.peer && client.can('videoCall', call.peer))) && (
              <RoundButton icon={localVideo ? Video : VideoOff} label="Camera" on={localVideo} onPress={() => calls.toggleCamera()} />
            )}
            {/* Like WhatsApp: flip between front and back camera from the button row. */}
            {localVideo && <RoundButton icon={SwitchCamera} label="Flip" onPress={() => calls.switchCamera()} />}
            <RoundButton icon={call.muted ? MicOff : Mic} label={call.muted ? 'Unmute' : 'Mute'} on={call.muted} onPress={() => calls.toggleMute()} />
            <RoundButton icon={PhoneOff} label="End" color={RED} onPress={() => void calls.hangup()} />
          </Animated.View>
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

/**
 * Thin bar over the app while a call runs in the background ("Tap to return to call"). For a ringing call it has
 * Decline and Accept, so a call can be answered or cut from any chat without opening the call screen.
 */
export function CallBar({ onPress }: { onPress: () => void }) {
  const call = useCall();
  const label = useCallLabel();
  const name = call.peer ? client.displayName(call.peer) : '';
  if (call.status === 'incoming') {
    return (
      <View style={[styles.bar, { backgroundColor: PANEL, paddingVertical: 8 }]}>
        <Pressable onPress={onPress} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLabel="Open the call">
          <Avatar name={call.peer ?? '?'} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: FG, fontWeight: '600' }} numberOfLines={1}>
              {name}
            </Text>
            <Text style={{ color: FG_MUTED, fontSize: 12 }}>Incoming {call.video ? 'video' : 'voice'} call</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => void calls.reject()} accessibilityLabel="Decline" style={[styles.barBtn, { backgroundColor: RED }]}>
          <PhoneOff size={18} color="#fff" />
        </Pressable>
        <Pressable onPress={() => (void calls.accept(), onPress())} accessibilityLabel="Accept" style={[styles.barBtn, { backgroundColor: GREEN }]}>
          {call.video ? <Video size={18} color="#fff" /> : <Phone size={18} color="#fff" />}
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} style={styles.bar} accessibilityLabel="Return to call">
      {call.video ? <Video size={16} color="#fff" /> : <Phone size={16} color="#fff" />}
      <Text style={{ color: '#fff', fontWeight: '600', flex: 1 }} numberOfLines={1}>
        {name} · {label} · tap to return
      </Text>
      <Pressable onPress={() => void calls.hangup()} accessibilityLabel="End call" hitSlop={8} style={[styles.barBtn, { backgroundColor: RED, width: 34, height: 34 }]}>
        <PhoneOff size={16} color="#fff" />
      </Pressable>
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
  pip: { position: 'absolute', width: PIP_W, height: PIP_H, borderRadius: 14, overflow: 'hidden', backgroundColor: PANEL, elevation: 6 },
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
  barBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
