import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  File,
  FileText,
  Forward,
  Image as ImageIcon,
  Lock,
  MessageSquare,
  Mic,
  TriangleAlert,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { formatBytes, isGroupKey, toBase64, type Attachment } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { IconButton, Sheet, errorText } from '../ui';

const ICON: Record<Attachment['kind'], LucideIcon> = { image: ImageIcon, pdf: FileText, audio: Mic, file: File };

// ---------------------------------------------------------------------------------------------
// Full-screen viewer. It is rendered INSIDE the main activity window (not a RN <Modal>, which on
// Android is a separate window that FLAG_SECURE does not cover), so screenshots stay blocked.

type Open = { a: Attachment; kind: 'image' | 'pdf'; b64: string } | null;
let current: Open = null;
/**
 * The "share to which chat" picker. Everyone may share files on to other chats; there is deliberately no way
 * to save or share a file outside CellMate.
 */
let forwardFor: Attachment | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
const setOpen = (o: Open) => {
  current = o;
  changed();
};
const showForward = (a: Attachment | null) => {
  forwardFor = a;
  changed();
};

/** Open a file full-screen (photos and PDFs), or the share-to-a-chat picker for other files. */
export function openAttachment(a: Attachment): boolean {
  if (!a.data) return false;
  if (a.kind === 'image' || a.kind === 'pdf') setOpen({ a, kind: a.kind, b64: toBase64(a.data) });
  else showForward(a);
  return true;
}

export function MediaViewerHost({ onToast }: { onToast: (m: string) => void }) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const c = useClient();
  useEffect(() => {
    listeners.add(bump);
    return () => void listeners.delete(bump);
  }, []);
  useEffect(() => {
    if (!current) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (setOpen(null), true));
    return () => sub.remove();
  });

  const forward = async (key: string, a: Attachment) => {
    try {
      await client.forwardAttachment(key, a);
      onToast(`Shared ${a.name} with ${c.chatTitle(key)}`);
    } catch (e) {
      onToast(errorText(e));
    }
  };

  const o = current;
  return (
    <>
      {o && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
          <View style={s.header}>
            <IconButton icon={X} label="Close" onPress={() => setOpen(null)} />
            <View style={{ flex: 1 }}>
              <Text style={s.textStrong} numberOfLines={1}>
                {o.a.name}
              </Text>
              <View style={[s.row, { gap: 4 }]}>
                <Lock size={11} color={colors.muted} />
                <Text style={[s.muted, { fontSize: 12 }]}>Stays inside CellMate</Text>
              </View>
            </View>
            <IconButton icon={Forward} label="Share to a chat" onPress={() => showForward(o.a)} />
          </View>
          {o.kind === 'image' ? (
            <Image source={{ uri: `data:${o.a.mime};base64,${o.b64}` }} style={{ flex: 1 }} resizeMode="contain" />
          ) : (
            <PdfView b64={o.b64} />
          )}
        </View>
      )}
      {forwardFor && (
        <Sheet
          title={`Share ${forwardFor.name} to…`}
          onClose={() => showForward(null)}
          actions={c.chatKeys().map((key) => {
            const a = forwardFor!;
            return { icon: isGroupKey(key) ? UsersRound : MessageSquare, label: c.chatTitle(key), onPress: () => void forward(key, a) };
          })}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

/**
 * Photos / PDFs / files inside a chat bubble, shown from memory. Long-press or the share button shares it
 * to another chat; nothing can take it outside CellMate.
 */
export function AttachmentView({ a }: { a: Attachment }) {
  const b64 = useMemo(() => (a.data ? toBase64(a.data) : null), [a.data]);
  const actions = b64 ? () => showForward(a) : undefined;

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
      <Pressable onPress={() => setOpen({ a, kind: 'image', b64 })} onLongPress={actions}>
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
        onPress={() => setOpen({ a, kind: 'pdf', b64 })}
        onActions={actions}
      />
    );
  }

  return <Card icon={File} name={a.name} sub={`${formatBytes(a.size)} · Preview not available`} onActions={actions} />;
}

function Card({
  icon: Icon,
  name,
  sub,
  busy,
  pdf,
  warn,
  onPress,
  onActions,
}: {
  icon: LucideIcon;
  name: string;
  sub: string;
  busy?: boolean;
  pdf?: boolean;
  warn?: boolean;
  onPress?: () => void;
  /** Share to another chat (once the file is ready). */
  onActions?: () => void;
}) {
  const [bg, fg] = warn ? [colors.warnSoft, colors.warn] : pdf ? ['#fef3f2', '#d92d20'] : [colors.accentSoft, colors.accent];
  return (
    <Pressable onPress={onPress} onLongPress={onActions} disabled={!onPress && !onActions} style={styles.card}>
      <View style={[styles.cardIcon, { backgroundColor: bg }]}>
        {busy ? <ActivityIndicator size="small" color={fg} /> : <Icon size={20} color={fg} />}
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={s.textStrong} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[s.muted, { fontSize: 12 }]}>{sub}</Text>
      </View>
      {onActions && <IconButton icon={Forward} label="Share to a chat" size={18} onPress={onActions} />}
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
