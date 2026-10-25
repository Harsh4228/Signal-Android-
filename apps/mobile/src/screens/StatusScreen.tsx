import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Eye, ImagePlus, Palette, Send, Trash2, Type, X } from 'lucide-react-native';
import { MAX_STATUS_TEXT, STATUS_COLORS, toBase64, type OutgoingFile, type StatusUpdate } from '@meetme/core';
import { client, useClient } from '../messenger';
import { pickFile } from '../files';
import { colors, s } from '../theme';
import { Avatar, Header, IconButton, clock, errorText, shortTime } from '../ui';
import type { Route } from '../App';

const SHOW_MS = 5000;

function ago(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  return new Date(ts).toDateString() === new Date().toDateString() ? `Today ${clock(ts)}` : `Yesterday ${clock(ts)}`;
}

/** Avatar with WhatsApp's ring: one segment per status, grey once viewed. */
function Ring({ name, count, seen }: { name: string; count: number; seen: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const gap = count > 1 ? 4 : 0;
  const seg = c / count;
  return (
    <View style={{ width: 58, height: 58, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={58} height={58} style={StyleSheet.absoluteFill}>
        {Array.from({ length: count }, (_, i) => (
          <Circle
            key={i}
            cx={29}
            cy={29}
            r={r}
            fill="none"
            strokeWidth={2.5}
            stroke={i < seen ? colors.lineStrong : colors.ok}
            strokeDasharray={`${seg - gap} ${c - seg + gap}`}
            strokeDashoffset={-i * seg + c / 4}
          />
        ))}
      </Svg>
      <Avatar name={name} size={46} />
    </View>
  );
}

/** Status: my updates, and my contacts' updates of the last 24 hours. */
export function StatusScreen({ navigate }: { navigate: (r: Route) => void }) {
  const c = useClient();
  const me = c.account!.username;
  const mine = c.myStatuses();
  const groups = c.statusGroups();
  const recent = groups.filter((g) => !g.allSeen);
  const viewed = groups.filter((g) => g.allSeen);
  const offline = c.status !== 'online';

  const open = (user: string) => {
    const g = groups.find((x) => x.user === user);
    const first = g && !g.allSeen ? Math.max(0, g.items.findIndex((x) => !x.seen)) : 0;
    navigate({ name: 'status-view', user, start: first });
  };

  const person = (user: string, items: StatusUpdate[]) => (
    <Pressable
      key={user}
      onPress={() => open(user)}
      style={({ pressed }) => [s.row, styles.row, pressed && { backgroundColor: colors.hover }]}
    >
      <Ring name={user} count={items.length} seen={items.filter((x) => x.seen).length} />
      <View style={{ flex: 1 }}>
        <Text style={s.textStrong}>{user}</Text>
        <Text style={s.muted}>{ago(items[items.length - 1]!.ts)}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={s.fill}>
      <Header title="Status" onBack={() => navigate({ name: 'list' })} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={[s.card, { margin: 12 }]}>
          <Pressable
            onPress={() => (mine.length ? navigate({ name: 'status-view', user: me, start: 0 }) : undefined)}
            style={({ pressed }) => [s.row, styles.row, pressed && mine.length > 0 && { backgroundColor: colors.hover }]}
          >
            {mine.length ? <Ring name={me} count={mine.length} seen={mine.length} /> : <Avatar name={me} size={50} />}
            <View style={{ flex: 1 }}>
              <Text style={s.textStrong}>My status</Text>
              <Text style={s.muted}>
                {mine.length ? `${mine.length} update${mine.length === 1 ? '' : 's'} · ${ago(mine[mine.length - 1]!.ts)}` : 'Share a text or photo for 24 hours'}
              </Text>
            </View>
            <IconButton icon={Type} label="Text status" disabled={offline} onPress={() => navigate({ name: 'status-new', mode: 'text' })} />
            <IconButton icon={ImagePlus} label="Photo status" disabled={offline} onPress={() => navigate({ name: 'status-new', mode: 'photo' })} />
          </Pressable>
        </View>
        {recent.length > 0 && <Text style={[s.section, { marginHorizontal: 16, marginTop: 8 }]}>Recent updates</Text>}
        {recent.length > 0 && <View style={[s.card, { marginHorizontal: 12 }]}>{recent.map((g) => person(g.user, g.items))}</View>}
        {viewed.length > 0 && <Text style={[s.section, { marginHorizontal: 16 }]}>Viewed updates</Text>}
        {viewed.length > 0 && <View style={[s.card, { marginHorizontal: 12 }]}>{viewed.map((g) => person(g.user, g.items))}</View>}
        <Text style={[s.muted, { fontSize: 12, textAlign: 'center', margin: 16, lineHeight: 18 }]}>
          {groups.length ? '' : 'No updates from your contacts yet. '}Your status goes to your contacts and the people in
          your groups, end-to-end encrypted, and disappears after 24 hours.
        </Text>
      </ScrollView>
    </View>
  );
}

export function StatusComposeScreen({
  mode,
  navigate,
  onToast,
}: {
  mode: 'text' | 'photo';
  navigate: (r: Route) => void;
  onToast: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [bg, setBg] = useState(STATUS_COLORS[0]!);
  const [photo, setPhoto] = useState<OutgoingFile | null>(null);
  const [busy, setBusy] = useState(false);
  const back = () => navigate({ name: 'status' });

  async function choose() {
    try {
      const f = await pickFile('photo');
      if (f) setPhoto(f);
      else if (!photo) back();
    } catch (e) {
      onToast(errorText(e));
    }
  }
  useEffect(() => {
    if (mode === 'photo') void choose();
  }, []);

  async function send() {
    setBusy(true);
    try {
      const r = await client.postStatus(mode === 'photo' && photo ? { photo, caption: text } : { text, bg });
      onToast(`Status shared with ${r.sent} ${r.sent === 1 ? 'person' : 'people'}`);
      back();
    } catch (e) {
      onToast(errorText(e));
      setBusy(false);
    }
  }

  const ready = mode === 'photo' ? !!photo : !!text.trim();
  return (
    <View style={[styles.stage, mode === 'text' && { backgroundColor: bg }]}>
      <View style={[s.row, { padding: 8 }]}>
        <IconButton icon={X} label="Cancel" color="#fff" onPress={back} />
        <View style={{ flex: 1 }} />
        {mode === 'text' && (
          <IconButton
            icon={Palette}
            label="Background colour"
            color="#fff"
            onPress={() => setBg(STATUS_COLORS[(STATUS_COLORS.indexOf(bg) + 1) % STATUS_COLORS.length]!)}
          />
        )}
      </View>
      {mode === 'text' ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
          <TextInput
            value={text}
            onChangeText={setText}
            maxLength={MAX_STATUS_TEXT}
            placeholder="Type a status"
            placeholderTextColor="rgba(255,255,255,0.6)"
            multiline
            autoFocus
            style={styles.bigText}
          />
        </View>
      ) : (
        <Pressable style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onPress={() => !photo && void choose()}>
          {photo ? (
            <Image source={{ uri: `data:${photo.mime};base64,${toBase64(photo.data)}` }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          ) : (
            <ImagePlus size={36} color="rgba(255,255,255,0.7)" />
          )}
        </Pressable>
      )}
      <View style={[s.row, { gap: 8, padding: 12 }]}>
        {mode === 'photo' ? (
          <TextInput
            value={text}
            onChangeText={setText}
            maxLength={MAX_STATUS_TEXT}
            placeholder="Add a caption…"
            placeholderTextColor="rgba(255,255,255,0.6)"
            style={styles.caption}
          />
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Pressable onPress={send} disabled={busy || !ready} style={[styles.send, (busy || !ready) && { opacity: 0.45 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Send size={20} color="#fff" />}
        </Pressable>
      </View>
    </View>
  );
}

/** Full-screen player: each update for 5 seconds; tap left / right to go back / on, hold to pause. */
export function StatusViewerScreen({
  user,
  start,
  navigate,
  onToast,
}: {
  user: string;
  start: number;
  navigate: (r: Route) => void;
  onToast: (m: string) => void;
}) {
  const c = useClient();
  const mineView = user === c.account?.username;
  const items = mineView ? c.myStatuses() : (c.statusGroups().find((g) => g.user === user)?.items ?? []);
  const [index, setIndex] = useState(start);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [showViewers, setShowViewers] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const st = items[Math.min(index, items.length - 1)];
  const close = () => navigate({ name: 'status' });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (close(), true));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setPhoto(null);
    setElapsed(0);
    if (!st) return;
    if (!st.outgoing) client.markStatusSeen(st.id, st.from);
    if (!st.photo) return;
    let gone = false;
    client
      .statusPhoto(st)
      .then((data) => !gone && setPhoto(`data:${st.photo!.mime};base64,${toBase64(data)}`))
      .catch((e) => !gone && onToast(errorText(e)));
    return () => {
      gone = true;
    };
  }, [st?.id]);

  const hold = paused || showViewers || (!!st?.photo && !photo);
  useEffect(() => {
    if (hold || !st) return;
    const t = setInterval(() => setElapsed((e) => e + 100), 100);
    return () => clearInterval(t);
  }, [hold, st?.id]);

  const next = () => (index + 1 < items.length ? setIndex(index + 1) : close());
  const prev = () => setIndex(Math.max(0, index - 1));
  useEffect(() => {
    if (elapsed >= SHOW_MS) next();
  }, [elapsed]);
  useEffect(() => {
    if (!st) close();
  }, [st]);
  if (!st) return null;

  const viewers = Object.entries(st.viewers ?? {}).sort((a, b) => b[1] - a[1]);
  const remove = () =>
    Alert.alert('Delete status', 'Delete this status for everyone?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void client.deleteStatus(st.id).catch((e) => onToast(errorText(e))) },
    ]);

  return (
    <View style={[styles.stage, !st.photo && { backgroundColor: st.bg ?? STATUS_COLORS[0] }]}>
      <View style={[s.row, { gap: 4, paddingHorizontal: 8, paddingTop: 8 }]}>
        {items.map((x, i) => (
          <View key={x.id} style={styles.bar}>
            <View
              style={[styles.barFill, { width: `${i < index ? 100 : i === index ? Math.min(100, (elapsed / SHOW_MS) * 100) : 0}%` }]}
            />
          </View>
        ))}
      </View>
      <View style={[s.row, { gap: 10, padding: 8 }]}>
        <Avatar name={user} size={36} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>{mineView ? 'My status' : user}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{ago(st.ts)}</Text>
        </View>
        {mineView && <IconButton icon={Trash2} label="Delete for everyone" color="#fff" onPress={remove} />}
        <IconButton icon={X} label="Close" color="#fff" onPress={close} />
      </View>

      <View style={{ flex: 1 }}>
        {st.photo ? (
          photo ? (
            <Image source={{ uri: photo }} style={{ flex: 1 }} resizeMode="contain" />
          ) : (
            <View style={s.center}>
              <ActivityIndicator color="#fff" />
            </View>
          )
        ) : (
          <View style={[s.center, { padding: 28 }]}>
            <Text style={[styles.bigText, { textAlign: 'center' }]}>{st.text}</Text>
          </View>
        )}
        {/* Tap zones: left third back, the rest forward; hold anywhere to pause. */}
        <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
          <Pressable style={{ flex: 1 }} onPress={prev} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} />
          <Pressable style={{ flex: 2 }} onPress={next} onLongPress={() => setPaused(true)} onPressOut={() => setPaused(false)} />
        </View>
      </View>

      {!!st.photo && !!st.text && <Text style={styles.captionText}>{st.text}</Text>}
      {mineView && (
        <View style={{ padding: 12, alignItems: 'center' }}>
          <Pressable onPress={() => setShowViewers(!showViewers)} style={[s.row, styles.seen]}>
            <Eye size={16} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '500' }}>
              Seen by {viewers.length} of {st.audience?.length ?? 0}
            </Text>
          </Pressable>
          {showViewers && (
            <View style={[s.card, { alignSelf: 'stretch', marginTop: 10, padding: 8, maxHeight: 240 }]}>
              <ScrollView>
                {viewers.length ? (
                  viewers.map(([u, ts]) => (
                    <View key={u} style={[s.row, { gap: 10, padding: 6 }]}>
                      <Avatar name={u} size={32} />
                      <Text style={[s.text, { flex: 1 }]}>{client.displayName(u)}</Text>
                      <Text style={s.muted}>{shortTime(ts)}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={[s.muted, { padding: 6 }]}>No views yet</Text>
                )}
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  stage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#0a0e16' },
  bigText: { color: '#fff', fontSize: 26, lineHeight: 34, fontWeight: '500', textAlign: 'center' },
  caption: {
    flex: 1,
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center' },
  bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: '#fff' },
  captionText: { color: '#fff', fontSize: 15, textAlign: 'center', padding: 12 },
  seen: { gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)' },
});
