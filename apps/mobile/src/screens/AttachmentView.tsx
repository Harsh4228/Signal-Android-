import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ZoomImage } from '../ZoomImage';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  Download,
  File,
  FileText,
  Film,
  Play,
  RotateCw,
  Forward,
  Image as ImageIcon,
  Lock,
  MessageSquare,
  Mic,
  TriangleAlert,
  UsersRound,
  X,
  type LucideIcon,
  Share2,
} from 'lucide-react-native';
import { formatBytes, isGroupKey, toBase64, type Attachment, type ChatMessage } from '@meetme/core';
import { client, useClient } from '../messenger';
import { colors, s } from '../theme';
import { IconButton, Sheet, errorText } from '../ui';
import { saveToDevice, shareOut } from '../deviceFiles';
import { SendPicker } from './SendPicker';
import { MediaPlayer } from './VideoView';

const ICON: Record<Attachment['kind'], LucideIcon> = { image: ImageIcon, video: Film, pdf: FileText, audio: Mic, file: File };

/** Share outside CellMate works on a message: the viewer only has the file. */
const asMessage = (a: Attachment) => ({ id: '', peer: client.activeChat ?? '', text: '', ts: 0, outgoing: false, attachment: a }) as ChatMessage;

// ---------------------------------------------------------------------------------------------
// Full-screen viewer. It is rendered INSIDE the main activity window (not a RN <Modal>, which on
// Android is a separate window that FLAG_SECURE does not cover), so screenshots stay blocked.

/** video / audio: played from a temporary private file (see MediaPlayer); `b64` is only used for photos and PDFs. */
type Open = { a: Attachment; kind: 'image' | 'pdf' | 'video' | 'audio'; b64: string } | null;
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
  else if (a.kind === 'video') setOpen({ a, kind: 'video', b64: '' });
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
      await client.forwardAttachment(key, a, client.activeChat ?? undefined);
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
                <Text style={[s.muted, { fontSize: 12 }]}>{c.can('download', c.activeChat) ? 'End-to-end encrypted' : 'Stays inside CellMate'}</Text>
              </View>
            </View>
            {c.can('download', c.activeChat) && (
              <IconButton
                icon={Download}
                label="Save to phone"
                onPress={() => void saveToDevice(o.a, c.activeChat ?? '').then((where) => onToast(`Saved to ${where}`), (e) => onToast(errorText(e)))}
              />
            )}
            {c.canShareOut(asMessage(o.a), c.activeChat ?? '') && (
              <IconButton
                icon={Share2}
                label="Share to another app"
                onPress={() => void shareOut(asMessage(o.a), c.activeChat ?? '').catch((e) => onToast(errorText(e)))}
              />
            )}
            {c.can('forward', c.activeChat) && <IconButton icon={Forward} label="Share to a chat" onPress={() => showForward(o.a)} />}
          </View>
          {o.kind === 'image' ? (
            <ZoomImage uri={`data:${o.a.mime};base64,${o.b64}`} />
          ) : o.kind === 'video' || o.kind === 'audio' ? (
            <MediaPlayer a={o.a} audio={o.kind === 'audio'} />
          ) : (
            <PdfView b64={o.b64} />
          )}
        </View>
      )}
      {forwardFor && (
        <SendPicker
          title={`Share ${forwardFor.name} to…`}
          icon={Forward}
          files
          submit={(n) => `Share${n > 1 ? ` with ${n} chats` : ''}`}
          onClose={() => showForward(null)}
          onSend={async (keys) => {
            const a = forwardFor!;
            showForward(null);
            for (const key of keys) await forward(key, a);
          }}
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
/** A voice message this phone's own player can't play (WebM from a computer, on an iPhone): open the web player. */
export function openInPlayer(a: Attachment) {
  if (a.data) setOpen({ a, kind: a.kind === 'video' ? 'video' : 'audio', b64: '' });
}

/**
 * Photos / videos / PDFs / files inside a chat bubble, shown from memory. Long-press or the share button shares it
 * to another chat; nothing can take it outside CellMate (unless the admin allows saving / sharing out).
 */
export function AttachmentView({
  a,
  onRetry,
  onCancel,
  sticker,
}: {
  a: Attachment;
  onRetry?: () => void;
  /** Uploading / downloading now: stop it. */
  onCancel?: () => void;
  sticker?: boolean;
}) {
  // Only photos are turned into a data: URL for the bubble; videos are played from a file when tapped.
  const b64 = useMemo(() => (a.data && a.kind !== 'video' ? toBase64(a.data) : null), [a.data, a.kind]);
  const ready = a.kind === 'video' ? !!a.data : !!b64;
  const actions = ready && client.can('forward', client.activeChat) ? () => showForward(a) : undefined;
  const preview = a.thumb ? `data:image/jpeg;base64,${a.thumb}` : null;
  const pct = a.progress !== undefined ? ` · ${Math.round(a.progress * 100)}%` : '';

  if (sticker && b64 && a.state === 'ready') {
    return <Image source={{ uri: `data:${a.mime};base64,${b64}` }} style={{ width: 150, height: 150 }} resizeMode="contain" accessibilityLabel="Sticker" />;
  }

  if (a.state === 'uploading' || a.state === 'downloading' || !ready) {
    const failed = a.state === 'failed' || (a.state === 'ready' && !ready);
    if (preview && !failed && (a.kind === 'image' || a.kind === 'video')) {
      // The small preview (blurred) while the real file comes, like WhatsApp.
      return (
        <View style={styles.thumb}>
          <Image source={{ uri: preview }} style={[StyleSheet.absoluteFill, { borderRadius: 12 }]} blurRadius={8} resizeMode="cover" />
          <View style={styles.overlay}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.overlayText}>
              {a.state === 'uploading' ? 'Sending' : formatBytes(a.size)}
              {pct}
            </Text>
            {onCancel && <IconButton icon={X} label="Cancel" color="#fff" size={18} onPress={onCancel} />}
          </View>
        </View>
      );
    }
    return (
      <Card
        icon={failed ? TriangleAlert : ICON[a.kind]}
        warn={failed}
        name={a.name}
        sub={
          failed
            ? a.data
              ? 'Not sent · tap to try again'
              : 'Could not download · tap to try again'
            : `${a.state === 'uploading' ? 'Sending' : 'Downloading'} ${formatBytes(a.size)}${pct || '…'}`
        }
        busy={!failed}
        onPress={failed ? onRetry : undefined}
        retry={failed && !!onRetry}
        onCancel={failed ? undefined : onCancel}
      />
    );
  }

  if (a.kind === 'image') {
    return (
      <Pressable onPress={() => setOpen({ a, kind: 'image', b64: b64! })} onLongPress={actions}>
        <Image source={{ uri: `data:${a.mime};base64,${b64}` }} style={styles.thumb} resizeMode="cover" />
      </Pressable>
    );
  }

  if (a.kind === 'video') {
    return (
      <Pressable onPress={() => setOpen({ a, kind: 'video', b64: '' })} onLongPress={actions} accessibilityLabel="Play video">
        <View style={[styles.thumb, { backgroundColor: '#1f2937' }]}>
          {preview && <Image source={{ uri: preview }} style={[StyleSheet.absoluteFill, { borderRadius: 12 }]} resizeMode="cover" />}
          <View style={styles.overlay}>
            <View style={styles.play}>
              <Play size={24} color="#fff" fill="#fff" />
            </View>
          </View>
          <Text style={[styles.overlayText, { position: 'absolute', left: 8, bottom: 8 }]}>{formatBytes(a.size)}</Text>
        </View>
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
        onPress={() => setOpen({ a, kind: 'pdf', b64: b64! })}
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
  retry,
  onCancel,
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
  retry?: boolean;
  onCancel?: () => void;
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
      {retry && onPress && <IconButton icon={RotateCw} label="Try again" size={18} onPress={onPress} />}
      {onCancel && <IconButton icon={X} label="Cancel" size={18} onPress={onCancel} />}
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
  thumb: { width: 230, height: 230, borderRadius: 12, marginBottom: 4, backgroundColor: colors.hover, overflow: 'hidden' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.2)' },
  overlayText: { color: '#fff', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  play: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' },
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
