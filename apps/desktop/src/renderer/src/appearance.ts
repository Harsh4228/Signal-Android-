import { WALLPAPERS, type MessageTone } from '@meetme/core';
import { client } from './messenger';

/** The colour of a chat wallpaper for the current theme ('' = the normal chat background). */
export function wallpaperColor(id: string): string {
  const w = WALLPAPERS.find((x) => x.id === id);
  if (!w || w.id === 'none') return '';
  return document.documentElement.dataset.theme === 'dark' ? w.dark : w.light;
}

let ctx: AudioContext | null = null;
let lastAt = 0;

/** A short message tone made with Web Audio (no sound files). Several messages at once play it once. */
export function playTone(tone: MessageTone): void {
  if (tone === 'none' || Date.now() - lastAt < 1500) return;
  lastAt = Date.now();
  try {
    ctx ??= new AudioContext();
    const c = ctx;
    const notes = tone === 'bell' ? [1318, 1760] : tone === 'soft' ? [523] : [880, 1175];
    const vol = tone === 'soft' ? 0.08 : 0.12;
    notes.forEach((f, i) => {
      const start = c.currentTime + i * 0.12;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(vol, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + (tone === 'bell' ? 0.6 : 0.25));
      gain.connect(c.destination);
      const osc = c.createOscillator();
      osc.type = tone === 'soft' ? 'sine' : 'triangle';
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(start);
      osc.stop(start + 0.65);
    });
  } catch {
    /* no audio device */
  }
}

/** Play the chat's tone for new messages while CellMate is open (muted chats and the open chat stay quiet). */
export function startMessageTones(): () => void {
  return client.on('message', (m) => {
    const t = client.toneFor(m);
    if (t) playTone(t);
  });
}
