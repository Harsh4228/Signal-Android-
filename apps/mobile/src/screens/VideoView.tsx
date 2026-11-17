import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { CachesDirectoryPath, exists, mkdir, unlink, writeFile } from '@dr.pogodin/react-native-fs';
import { randomBytes, toBase64, type Attachment } from '@meetme/core';
import { colors } from '../theme';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const extOf = (mime: string, name: string) =>
  /webm/i.test(mime) ? 'webm' : /quicktime/i.test(mime) || /\.mov$/i.test(name) ? 'mov' : /3gpp/i.test(mime) ? '3gp' : /ogg/i.test(mime) ? 'ogg' : 'mp4';

/**
 * Plays a video (or a voice message the phone's own player can't play, e.g. WebM on an iPhone) with the system's
 * web player. Like voice messages, the file is decrypted into the app's private cache folder only while it is
 * shown, and deleted when the player closes. No download / picture-in-picture buttons; nothing loads from the web.
 */
export function MediaPlayer({ a, audio }: { a: Attachment; audio?: boolean }) {
  const [dir, setDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!a.data) return;
    let gone = false;
    const folder = `${CachesDirectoryPath}/p-${hex(randomBytes(8))}`;
    const ext = extOf(a.mime, a.name);
    const tag = audio ? 'audio' : 'video';
    const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self' file:; style-src 'unsafe-inline'">
<style>html,body{margin:0;height:100%;background:#000;display:flex;align-items:center;justify-content:center}
${tag}{max-width:100%;max-height:100%;${audio ? 'width:90%' : 'width:100%'}}</style></head><body>
<${tag} src="m.${ext}" controls autoplay playsinline disablepictureinpicture controlslist="nodownload noremoteplayback" oncontextmenu="return false"></${tag}>
</body></html>`;
    (async () => {
      await mkdir(folder);
      await writeFile(`${folder}/m.${ext}`, toBase64(a.data!), 'base64');
      await writeFile(`${folder}/index.html`, page, 'utf8');
      if (!gone) setDir(folder);
    })().catch((e) => !gone && setError(String(e?.message ?? e)));
    return () => {
      gone = true;
      void exists(folder)
        .then((e) => (e ? unlink(folder) : undefined))
        .catch(() => {});
    };
  }, [a.data, a.mime, a.name, audio]);

  if (error) return <Text style={{ color: colors.danger, padding: 16 }}>Could not play: {error}</Text>;
  if (!dir) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  const base = `file://${dir}`;
  return (
    <WebView
      style={{ flex: 1, backgroundColor: '#000' }}
      source={{ uri: `${base}/index.html` }}
      originWhitelist={['file://*']}
      // Only our own player page in this folder; links, other files and the web are never opened.
      onShouldStartLoadWithRequest={(r) => r.url.startsWith(base)}
      allowFileAccess
      allowFileAccessFromFileURLs={Platform.OS === 'android'}
      allowingReadAccessToURL={base}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsPictureInPictureMediaPlayback={false}
      allowsLinkPreview={false}
      cacheEnabled={false}
      incognito
      setSupportMultipleWindows={false}
      javaScriptEnabled={false}
    />
  );
}
