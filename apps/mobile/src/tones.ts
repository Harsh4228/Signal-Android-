import Sound from 'react-native-nitro-sound';
import { CachesDirectoryPath, exists, writeFile } from '@dr.pogodin/react-native-fs';
import { toBase64, type MessageTone } from '@meetme/core';
import { client } from './messenger';
import { audioBusy } from './voice';

/**
 * Message tones while CellMate is open (when it is closed the phone's own notification sound plays). The tones are
 * tiny WAV files made here in code (no sound files shipped) and played with the voice-message player.
 */
const RATE = 22050;

function wav(tone: Exclude<MessageTone, 'none'>): Uint8Array {
  const notes = tone === 'bell' ? [1318, 1760] : tone === 'soft' ? [523] : [880, 1175];
  const step = 0.12;
  const length = tone === 'bell' ? 0.6 : 0.25;
  const vol = tone === 'soft' ? 0.25 : 0.35;
  const total = Math.ceil((step * (notes.length - 1) + length) * RATE);
  const pcm = new Int16Array(total);
  notes.forEach((f, n) => {
    const start = Math.floor(n * step * RATE);
    for (let i = 0; i < length * RATE && start + i < total; i++) {
      const t = i / RATE;
      const env = Math.min(1, t / 0.015) * Math.exp(-t * (tone === 'bell' ? 6 : 14));
      const wave = tone === 'soft' ? Math.sin(2 * Math.PI * f * t) : (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * t));
      pcm[start + i] = Math.max(-32767, Math.min(32767, pcm[start + i]! + wave * env * vol * 32767));
    }
  });
  const out = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(out.buffer);
  const str = (o: number, x: string) => [...x].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((x, i) => v.setInt16(44 + i * 2, x, true));
  return out;
}

let lastAt = 0;
let tonePlaying = false;

export async function playTone(tone: MessageTone): Promise<void> {
  if (tone === 'none' || tonePlaying || audioBusy() || Date.now() - lastAt < 1500) return;
  lastAt = Date.now();
  tonePlaying = true;
  try {
    const path = `${CachesDirectoryPath}/tone-${tone}.wav`;
    if (!(await exists(path))) await writeFile(path, toBase64(wav(tone)), 'base64');
    await Sound.startPlayer(`file://${path}`);
    setTimeout(() => {
      tonePlaying = false;
      if (!audioBusy()) void Sound.stopPlayer().catch(() => {});
    }, 900);
  } catch {
    tonePlaying = false;
  }
}

/** Play the chat's tone for new messages while CellMate is open (muted chats and the open chat stay quiet). */
export function startMessageTones(): () => void {
  return client.on('message', (m) => {
    const t = client.toneFor(m);
    if (t) void playTone(t);
  });
}
