import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { File, FileText, Image as ImageIcon, Lock, TriangleAlert, X, type LucideIcon } from 'lucide-react-native';
import { formatBytes, toBase64, type Attachment } from '@meetme/core';
import { colors, s } from '../theme';
import { IconButton } from '../ui';

const ICON: Record<Attachment['kind'], LucideIcon> = { image: ImageIcon, pdf: FileText, file: File };

// ---------------------------------------------------------------------------------------------
// Full-screen viewer. It is rendered INSIDE the main activity window (not a RN <Modal>, which on
// Android is a separate window that FLAG_SECURE does not cover), so screenshots stay blocked.

type Open = { title: string; kind: 'image' | 'pdf'; mime: string; b64: string } | null;
let current: Open = null;
const listeners = new Set<() => void>();
const setOpen = (o: Open) => {
  current = o;
  listeners.forEach((l) => l());
};

export function MediaViewerHost() {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(bump);
    return () => void listeners.delete(bump);
  }, []);
  useEffect(() => {
    if (!current) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (setOpen(null), true));
    return () => sub.remove();
  });
  if (!current) return null;
  const o = current;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <View style={s.header}>
        <IconButton icon={X} label="Close" onPress={() => setOpen(null)} />
        <View style={{ flex: 1 }}>
          <Text style={s.textStrong} numberOfLines={1}>
            {o.title}
          </Text>
          <View style={[s.row, { gap: 4 }]}>
            <Lock size={11} color={colors.muted} />
            <Text style={[s.muted, { fontSize: 12 }]}>View only · not saved to this device</Text>
          </View>
        </View>
      </View>
      {o.kind === 'image' ? (
        <Image source={{ uri: `data:${o.mime};base64,${o.b64}` }} style={{ flex: 1 }} resizeMode="contain" />
      ) : (
        <PdfView b64={o.b64} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------

/** Photos / PDFs / files inside a chat bubble. Everything is shown from memory; nothing is saved. */
export function AttachmentView({ a }: { a: Attachment }) {
  const b64 = useMemo(() => (a.data ? toBase64(a.data) : null), [a.data]);

  if (a.state === 'uploading' || a.state === 'downloading' || !b64) {
    const failed = a.state === 'failed' || (a.state === 'ready' && !b64);
    return (
      <Card
        icon={failed ? TriangleAlert : ICON[a.kind]}
        warn={failed}
        name={a.name}
        sub={failed ? 'File unavailable' : a.state === 'uploading' ? 'Encrypting & sending…' : 'Decrypting…'}
        busy={!failed}
      />
    );
  }

  if (a.kind === 'image') {
    return (
      <Pressable onPress={() => setOpen({ title: a.name, kind: 'image', mime: a.mime, b64 })}>
        <Image source={{ uri: `data:${a.mime};base64,${b64}` }} style={styles.thumb} resizeMode="cover" />
      </Pressable>
    );
  }

  if (a.kind === 'pdf') {
    return (
      <Card
        icon={FileText}
        pdf
        name={a.name}
        sub={`${formatBytes(a.size)} · Tap to view`}
        onPress={() => setOpen({ title: a.name, kind: 'pdf', mime: a.mime, b64 })}
      />
    );
  }

  return <Card icon={File} name={a.name} sub={`${formatBytes(a.size)} · Preview not available`} />;
}

function Card({
  icon: Icon,
  name,
  sub,
  busy,
  pdf,
  warn,
  onPress,
}: {
  icon: LucideIcon;
  name: string;
  sub: string;
  busy?: boolean;
  pdf?: boolean;
  warn?: boolean;
  onPress?: () => void;
}) {
  const [bg, fg] = warn ? [colors.warnSoft, colors.warn] : pdf ? ['#fef3f2', '#d92d20'] : [colors.accentSoft, colors.accent];
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={styles.card}>
      <View style={[styles.cardIcon, { backgroundColor: bg }]}>
        {busy ? <ActivityIndicator size="small" color={fg} /> : <Icon size={20} color={fg} />}
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={s.textStrong} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[s.muted, { fontSize: 12 }]}>{sub}</Text>
      </View>
    </Pressable>
  );
}

/**
 * Android: bundled offline pdf.js page (assets/pdfviewer.html), PDF bytes sent in by postMessage.
 * iOS: WKWebView renders the PDF natively straight from memory.
 */
function PdfView({ b64 }: { b64: string }) {
  // WebView<P = undefined> makes all props `never` when P is inferred from the ref, so pin P to {}.
  const ref = useRef<WebView<{}>>(null);
  const [error, setError] = useState<string | null>(null);

  // Never navigate anywhere else (links inside PDFs are ignored).
  const onlyViewer = (r: { url: string }) =>
    r.url.startsWith('file:///android_asset/pdfviewer.html') || r.url.startsWith('data:') || r.url === 'about:blank';

  if (Platform.OS === 'ios') {
    return (
      <WebView
        style={{ flex: 1, backgroundColor: colors.bg }}
        originWhitelist={['*']}
        source={{ uri: `data:application/pdf;base64,${b64}` }}
        cacheEnabled={false}
        incognito
        allowsLinkPreview={false}
        textInteractionEnabled={false}
        onShouldStartLoadWithRequest={onlyViewer}
      />
    );
  }

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const m = JSON.parse(e.nativeEvent.data);
      if (m.type === 'ready') ref.current?.postMessage(JSON.stringify({ type: 'load', data: b64 }));
      if (m.type === 'error') setError(m.message);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <WebView
        ref={ref}
        style={{ flex: 1, backgroundColor: colors.bg }}
        javaScriptEnabled
        cacheEnabled={false}
        incognito
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={onlyViewer}
        originWhitelist={['file://*']}
        source={{ uri: 'file:///android_asset/pdfviewer.html' }}
        onMessage={onMessage}
        allowFileAccess={false}
        mixedContentMode="never"
      />
      {error && <Text style={{ color: colors.danger, padding: 12 }}>Could not open PDF: {error}</Text>}
    </>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 230, height: 230, borderRadius: 12, marginBottom: 4, backgroundColor: colors.hover },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 10,
    marginBottom: 4,
    minWidth: 220,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
