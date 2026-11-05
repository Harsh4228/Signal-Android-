import { useMemo, useRef, useState } from 'react';
import { Image, PanResponder, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

const MAX = 5;
const DOUBLE_TAP_MS = 280;

/**
 * A photo filling its box (whole picture visible) that can be zoomed like in WhatsApp: pinch to zoom (up to 5x),
 * drag to move around when zoomed, double-tap to zoom in / back out.
 */
export function ZoomImage({ uri }: { uri: string }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [, redraw] = useState(0);
  const st = useRef({ scale: 1, x: 0, y: 0, last: null as { x: number; y: number } | null, dist: 0, fingers: 0, tapAt: 0, moved: false });

  /** Keep the picture covering the box: no dragging it away past its edges. */
  const clamp = () => {
    const s = st.current;
    const mx = (box.w * (s.scale - 1)) / 2;
    const my = (box.h * (s.scale - 1)) / 2;
    s.x = Math.max(-mx, Math.min(mx, s.x));
    s.y = Math.max(-my, Math.min(my, s.y));
  };

  const pan = useMemo(() => {
    const info = (e: GestureResponderEvent) => {
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        const a = t[0]!;
        const b = t[1]!;
        return { n: 2, at: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 }, dist: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) };
      }
      return { n: t.length, at: { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }, dist: 0 };
    };
    const start = (e: GestureResponderEvent) => {
      const i = info(e);
      Object.assign(st.current, { last: i.at, dist: i.dist, fingers: i.n });
    };
    return PanResponder.create({
      // Every touch: taps (double-tap), pinches and, once zoomed, drags.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (e) => st.current.scale > 1 || e.nativeEvent.touches.length >= 2,
      onPanResponderGrant: (e) => {
        st.current.moved = false;
        start(e);
      },
      onPanResponderMove: (e) => {
        const s = st.current;
        const i = info(e);
        if (i.n !== s.fingers || !s.last) return start(e);
        if (Math.abs(i.at.x - s.last.x) + Math.abs(i.at.y - s.last.y) > 2) s.moved = true;
        if (i.n === 2 && s.dist > 0) {
          s.scale = Math.max(1, Math.min(MAX, s.scale * (i.dist / s.dist)));
          s.moved = true;
        }
        if (s.scale > 1) {
          s.x += i.at.x - s.last.x;
          s.y += i.at.y - s.last.y;
        }
        clamp();
        s.last = i.at;
        s.dist = i.dist;
        redraw((n) => n + 1);
      },
      onPanResponderRelease: () => {
        const s = st.current;
        s.last = null;
        if (s.moved) return;
        // A tap: two quick taps zoom in to 2.5x, or back out.
        const now = Date.now();
        if (now - s.tapAt < DOUBLE_TAP_MS) {
          s.scale = s.scale > 1 ? 1 : 2.5;
          s.x = 0;
          s.y = 0;
          s.tapAt = 0;
          redraw((n) => n + 1);
        } else s.tapAt = now;
      },
      onPanResponderTerminate: () => (st.current.last = null),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.w, box.h]);

  const { scale, x, y } = st.current;
  return (
    <View style={{ flex: 1, overflow: 'hidden' }} onLayout={(e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} {...pan.panHandlers}>
      <Image
        source={{ uri }}
        style={{ flex: 1, transform: [{ translateX: x }, { translateY: y }, { scale }] }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
