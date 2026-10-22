import { PermissionsAndroid, Platform } from 'react-native';
import Sound from 'react-native-nitro-sound';
import { CachesDirectoryPath, exists, readFile, unlink, writeFile } from '@dr.pogodin/react-native-fs';
import { fromBase64, randomBytes, toBase64, type Attachment } from '@meetme/core';

const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Voice messages. The audio library records into a file and plays from a file, so both only exist briefly in
 * the app's private cache folder: a recording is read into memory and deleted at once; a voice message being
 * played is written there decrypted and deleted when it stops. Nothing goes to shared storage.
 */
const tmp = (ext: string) => `${CachesDirectoryPath}/v-${bytesToHex(randomBytes(8))}.${ext}`;
const remove = (path: string) => exists(path).then((e) => (e ? unlink(path) : undefined)).catch(() => {});

let recording: string | null = null;

export async function startRecording(onSecs: (secs: number) => void): Promise<void> {
  if (Platform.OS === 'android') {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (r !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Microphone permission denied');
  }
  const path = tmp('m4a');
  recording = path;
  Sound.addRecordBackListener((e) => onSecs(Math.floor(e.currentPosition / 1000)));
  await Sound.startRecorder(path);
}

/** Stop and return the recording (in memory; the file is deleted). null if cancelled / nothing recorded. */
export async function stopRecording(keep: boolean): Promise<{ data: Uint8Array; mime: string } | null> {
  const path = recording;
  recording = null;
  Sound.removeRecordBackListener();
  let out: string | null = null;
  try {
    out = await Sound.stopRecorder();
  } catch {
    // already stopped
  }
  const file = (out && out.replace(/^file:\/\//, '')) || path;
  if (!file) return null;
  try {
    if (!keep) return null;
    const data = fromBase64(await readFile(file, 'base64'));
    return data.length ? { data, mime: 'audio/mp4' } : null;
  } finally {
    await remove(file);
    if (path && path !== file) await remove(path);
  }
}

let playing: { path: string; done: () => void } | null = null;

/** Play a voice message; `onProgress` gets [position, length] in seconds. Resolves when it ends or is stopped. */
export async function play(a: Attachment, onProgress: (pos: number, len: number) => void): Promise<void> {
  await stopPlaying();
  if (!a.data) throw new Error('The voice message is not available');
  const ext = a.mime.includes('webm') ? 'webm' : a.mime.includes('ogg') ? 'ogg' : 'm4a';
  const path = tmp(ext);
  await writeFile(path, toBase64(a.data), 'base64');
  await new Promise<void>((resolve) => {
    const done = () => {
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
      void remove(path);
      if (playing?.path === path) playing = null;
      resolve();
    };
    playing = { path, done };
    Sound.addPlayBackListener((e) => onProgress(e.currentPosition / 1000, e.duration / 1000));
    Sound.addPlaybackEndListener(() => done());
    Sound.startPlayer(`file://${path}`).catch(() => done());
  });
}

export async function stopPlaying(): Promise<void> {
  if (!playing) return;
  const p = playing;
  await Sound.stopPlayer().catch(() => {});
  p.done();
}
