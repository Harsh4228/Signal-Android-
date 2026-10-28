import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { ChevronDown, Lock, Mic, MicOff, Phone, PhoneOff, SwitchCamera, UsersRound, Video, VideoOff, Volume2 } from 'lucide-react-native';
import { groupCalls, client, setSpeaker, useGroupCall, useSpeaker } from '../messenger';
import { Avatar, useBack } from '../ui';
import { useDuration } from './CallScreen';

const BG = '#0b141a';
const TILE = '#1f2c33';
const FG = '#e9edef';
const MUTED = '#8696a0';
const RED = '#f15c6d';
const GREEN = '#00a884';

function Round({ icon: Icon, label, onPress, on, color }: { icon: typeof Mic; label: string; onPress: () => void; on?: boolean; color?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Pressable
        onPress={onPress}
        accessibilityLabel={label}
        style={({ pressed }) => [styles.round, { backgroundColor: color ?? (on ? FG : 'rgba(255,255,255,0.12)') }, pressed && { opacity: 0.75 }]}
      >
        <Icon size={24} color={color ? '#fff' : on ? BG : FG} />
      </Pressable>
      <Text style={{ color: MUTED, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/** A tile: the person's video, or their picture; their name and a muted mark. */
function Tile({ name, user, streamURL, muted, mirror, width, height, waiting }: { name: string; user: string; streamURL?: string; muted?: boolean; mirror?: boolean; width: number; height: number; waiting?: boolean }) {
  return (
    <View style={[styles.tile, { width, height }]}>
      {streamURL ? (
        <RTCView streamURL={streamURL} style={StyleSheet.absoluteFill} objectFit="cover" mirror={mirror} />
      ) : (
        <View style={styles.center}>
          <Avatar name={user} size={Math.min(84, width / 2.4)} />
        </View>
      )}
      <View style={styles.label}>
        {muted && <MicOff size={13} color={FG} />}
        <Text style={{ color: FG, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>
          {name}
          {waiting ? ' · connecting…' : ''}
        </Text>
      </View>
    </View>
  );
}

/** Group call: ringing (Join / Decline), then everyone in tiles, like WhatsApp. */
export function GroupCallScreen({ onMinimize }: { onMinimize: () => void }) {
  const s = useGroupCall();
  const speaker = useSpeaker();
  const duration = useDuration(s.startedAt);
  const { width, height } = useWindowDimensions();
  useBack(onMinimize);
  const group = s.group ? client.chatTitle(s.group) : '';

  if (s.status === 'ringing') {
    return (
      <View style={[StyleSheet.absoluteFill, { backgroundColor: BG }]}>
        <View style={[styles.center, { gap: 12 }]}>
          <View style={styles.groupIcon}>
            <UsersRound size={52} color={FG} />
          </View>
          <Text style={styles.title}>{group}</Text>
          <Text style={{ color: MUTED, fontSize: 15 }}>
            {s.from ? client.displayName(s.from) : 'Someone'} is calling · group {s.video ? 'video' : 'voice'} call
          </Text>
        </View>
        <View style={styles.ringRow}>
          <Round icon={PhoneOff} label="Decline" color={RED} onPress={() => void groupCalls.decline()} />
          <Round icon={s.video ? Video : Phone} label="Join" color={GREEN} onPress={() => void groupCalls.join()} />
        </View>
      </View>
    );
  }

  const me = client.account?.username ?? '';
  const meVideo = s.video && !s.cameraOff && !!s.localStream?.getVideoTracks().length;
  const tiles = [
    { user: me, name: 'You', streamURL: meVideo ? s.localStream.toURL() : undefined, muted: s.muted, mirror: true },
    ...s.participants.map((p) => ({
      user: p.username,
      name: client.displayName(p.username),
      streamURL: p.stream && !p.cameraOff && p.stream.getVideoTracks().length ? p.stream.toURL() : undefined,
      muted: p.muted,
      waiting: !p.connected,
    })),
  ];
  // 1-2 people: stacked; 3-4: 2 x 2; more: 2 columns.
  const cols = tiles.length <= 2 ? 1 : 2;
  const rows = Math.ceil(tiles.length / cols);
  const areaH = height - 220;
  const w = (width - 12 - (cols - 1) * 6) / cols;
  const h = Math.max(120, (areaH - (rows - 1) * 6) / rows);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: BG }]}>
      <View style={styles.top}>
        <Pressable onPress={onMinimize} hitSlop={12} accessibilityLabel="Back to chats">
          <ChevronDown size={26} color={FG} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: FG, fontWeight: '600', fontSize: 16 }} numberOfLines={1}>
            {group}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Lock size={11} color={MUTED} />
            <Text style={{ color: MUTED, fontSize: 12 }}>
              {s.participants.length ? duration : 'Waiting for others to join…'}
            </Text>
          </View>
        </View>
        {meVideo ? (
          <Pressable onPress={() => groupCalls.switchCamera()} hitSlop={12} accessibilityLabel="Flip camera">
            <SwitchCamera size={22} color={FG} />
          </Pressable>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>
      <View style={styles.grid}>
        {tiles.map((t) => (
          <Tile key={t.user} {...t} width={w} height={h} />
        ))}
      </View>
      <View style={styles.controls}>
        <Round icon={Volume2} label="Speaker" on={speaker} onPress={() => setSpeaker(!speaker)} />
        {s.video && <Round icon={s.cameraOff ? VideoOff : Video} label="Camera" on={!s.cameraOff} onPress={() => groupCalls.toggleCamera()} />}
        <Round icon={s.muted ? MicOff : Mic} label={s.muted ? 'Unmute' : 'Mute'} on={s.muted} onPress={() => groupCalls.toggleMute()} />
        <Round icon={PhoneOff} label="Leave" color={RED} onPress={() => void groupCalls.leave()} />
      </View>
    </View>
  );
}

/** Thin bar while a group call runs behind the app. */
export function GroupCallBar({ onPress }: { onPress: () => void }) {
  const s = useGroupCall();
  const duration = useDuration(s.startedAt);
  return (
    <Pressable onPress={onPress} style={styles.bar} accessibilityLabel="Return to the group call">
      <UsersRound size={16} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '600', flex: 1 }} numberOfLines={1}>
        {s.group ? client.chatTitle(s.group) : 'Group call'} · {s.status === 'ringing' ? 'tap to answer' : `${duration} · tap to return`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  groupIcon: { width: 120, height: 120, borderRadius: 60, backgroundColor: TILE, alignItems: 'center', justifyContent: 'center' },
  title: { color: FG, fontSize: 26, fontWeight: '600' },
  ringRow: { position: 'absolute', bottom: 60, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around' },
  round: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  grid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 6, alignContent: 'center' },
  tile: { borderRadius: 14, overflow: 'hidden', backgroundColor: TILE },
  label: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingTop: 16,
    paddingBottom: 26,
    backgroundColor: TILE,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: GREEN },
});
