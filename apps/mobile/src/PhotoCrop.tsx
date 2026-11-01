import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { ZoomIn, ZoomOut } from 'lucide-react-native';
import { setCropper, type CropSquare, type PreparedPhoto } from './photos';

const MAX_ZOOM = 4;
type Pos = { x: number; y: number };
type Request = { photo: PreparedPhoto; title: string; done: (r: CropSquare | null) => void };

/** Mounted once in App: shows the cropper whenever pickProfilePhoto asks for one. */
export function PhotoCropHost() {
  const [req, setReq] = useState<Request | null>(null);
  useEffect(() => {
    setCropper((photo, title) => new Promise((done) => setReq({ photo, title, done })));
    return () => setCropper(null);
  }, []);
  if (!req) return null;
  const finish = (r: CropSquare | null) => {
    setReq(null);
    req.done(r);
  };
  return (
    <Modal visible animationType="fade" onRequestClose={() => finish(null)} statusBarTranslucent>
      <Cropper photo={req.photo} title={req.title} onDone={finish} />
    </Modal>
  );
}

/** Like WhatsApp: drag to move, pinch (or the buttons) to zoom; the round frame shows what becomes the photo. */
function Cropper({ photo, title, onDone }: { photo: PreparedPhoto; title: string; onDone: (r: CropSquare | null) => void }) {
  const win = useWindowDimensions();
  const view = Math.min(win.width - 32, win.height - 260, 420);
  const { width: w, height: h } = photo;
  // At zoom 1 the picture just covers the frame (its short side = the frame).
  const base = view / Math.min(w, h);
  const [, redraw] = useState(0);
  const st = useRef({ zoom: 1, pos: { x: (view - w * base) / 2, y: (view - h * base) / 2 } as Pos, last: null as Pos | null, dist: 0, fingers: 0 });

  const clamp = (p: Pos, scale: number): Pos => ({
    x: Math.min(0, Math.max(view - w * scale, p.x)),
    y: Math.min(0, Math.max(view - h * scale, p.y)),
  });
  /** Zoom keeping the centre of the frame on the same spot of the picture. */
  const zoomTo = (z: number) => {
    const s = st.current;
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    const old = base * s.zoom;
    const scale = base * next;
    const cx = (view / 2 - s.pos.x) / old;
    const cy = (view / 2 - s.pos.y) / old;
    s.zoom = next;
    s.pos = clamp({ x: view / 2 - cx * scale, y: view / 2 - cy * scale }, scale);
    redraw((n) => n + 1);
  };

  const pan = useMemo(() => {
    const touchInfo = (e: GestureResponderEvent) => {
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        const a = t[0]!;
        const b = t[1]!;
        return { n: 2, at: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 }, dist: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) };
      }
      return { n: t.length, at: { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, dist: 0 };
    };
    const start = (e: GestureResponderEvent) => {
      const i = touchInfo(e);
      Object.assign(st.current, { last: i.at, dist: i.dist, fingers: i.n });
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: start,
      onPanResponderMove: (e) => {
        const s = st.current;
        const i = touchInfo(e);
        // A finger was added or lifted: start measuring again from here, so nothing jumps.
        if (i.n !== s.fingers || !s.last) return start(e);
        if (i.n === 2 && s.dist > 0) zoomTo(s.zoom * (i.dist / s.dist));
        const scale = base * s.zoom;
        s.pos = clamp({ x: s.pos.x + i.at.x - s.last.x, y: s.pos.y + i.at.y - s.last.y }, scale);
        s.last = i.at;
        s.dist = i.dist;
        redraw((n) => n + 1);
      },
      onPanResponderRelease: () => (st.current.last = null),
      onPanResponderTerminate: () => (st.current.last = null),
    });
    // The photo and frame size don't change while the cropper is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, w, h]);

  const { zoom, pos } = st.current;
  const scale = base * zoom;
  const r = view / 2;
  const done = () => onDone({ x: -pos.x / scale, y: -pos.y / scale, side: view / scale });
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: view, height: view, overflow: 'hidden', backgroundColor: '#000' }} {...pan.panHandlers}>
        <Image source={{ uri: photo.uri }} style={{ position: 'absolute', left: pos.x, top: pos.y, width: w * scale, height: h * scale }} fadeDuration={0} />
        <Svg width={view} height={view} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Path
            d={`M0 0H${view}V${view}H0Z M0 ${r}a${r} ${r} 0 1 0 ${view} 0a${r} ${r} 0 1 0 ${-view} 0Z`}
            fill="rgba(0,0,0,0.55)"
            fillRule="evenodd"
          />
          <Circle cx={r} cy={r} r={r - 1} stroke="rgba(255,255,255,0.9)" strokeWidth={2} fill="none" />
        </Svg>
      </View>
      <Text style={styles.hint}>Drag to move · pinch to zoom</Text>
      <View style={styles.zoomRow}>
        <Pressable onPress={() => zoomTo(zoom / 1.25)} disabled={zoom <= 1} hitSlop={10} accessibilityLabel="Zoom out">
          <ZoomOut size={24} color={zoom <= 1 ? '#666' : '#fff'} />
        </Pressable>
        <Pressable onPress={() => zoomTo(zoom * 1.25)} disabled={zoom >= MAX_ZOOM} hitSlop={10} accessibilityLabel="Zoom in">
          <ZoomIn size={24} color={zoom >= MAX_ZOOM ? '#666' : '#fff'} />
        </Pressable>
      </View>
      <View style={styles.buttons}>
        <Pressable onPress={() => onDone(null)} style={styles.button} accessibilityRole="button">
          <Text style={styles.buttonText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={done} style={[styles.button, styles.primary]} accessibilityRole="button">
          <Text style={[styles.buttonText, { fontWeight: '700' }]}>Use photo</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 16 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600' },
  hint: { color: '#bbb', fontSize: 13 },
  zoomRow: { flexDirection: 'row', gap: 48 },
  buttons: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', justifyContent: 'center' },
  button: { flex: 1, maxWidth: 200, paddingVertical: 13, borderRadius: 24, borderWidth: 1, borderColor: '#555', alignItems: 'center' },
  primary: { backgroundColor: '#1d4ed8', borderColor: '#1d4ed8' },
  buttonText: { color: '#fff', fontSize: 15 },
});
