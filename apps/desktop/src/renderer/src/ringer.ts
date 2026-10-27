import type { CallState } from '@meetme/core';

/**
 * Call sounds made with Web Audio (no sound files to ship): a ringtone for an incoming call and the
 * ringback tone while my call rings out.
 */
type Tone = 'ringtone' | 'ringback';

let ctx: AudioContext | null = null;
let playing: Tone | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function beep(freqs: number[], start: number, length: number, volume: number) {
  const c = ctx!;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.02);
  gain.gain.setValueAtTime(volume, start + length - 0.05);
  gain.gain.linearRampToValueAtTime(0, start + length);
  gain.connect(c.destination);
  for (const f of freqs) {
    const osc = c.createOscillator();
    osc.frequency.value = f;
    osc.connect(gain);
    osc.start(start);
    osc.stop(start + length);
  }
}

/** One cycle of the pattern; it repeats every `period` seconds. */
const PATTERNS: Record<Tone, { period: number; play: (t: number) => void }> = {
  // Two short rising chimes.
  ringtone: {
    period: 2.4,
    play: (t) => {
      beep([784], t, 0.18, 0.18);
      beep([1047], t + 0.22, 0.28, 0.18);
      beep([784], t + 0.7, 0.18, 0.18);
      beep([1047], t + 0.92, 0.28, 0.18);
    },
  },
  // The usual "ring… ring…" heard while calling out.
  ringback: { period: 4, play: (t) => beep([440, 480], t, 1.6, 0.06) },
};

function start(tone: Tone) {
  if (playing === tone) return;
  stop();
  ctx ??= new AudioContext();
  void ctx.resume();
  const p = PATTERNS[tone];
  const cycle = () => p.play(ctx!.currentTime + 0.05);
  cycle();
  timer = setInterval(cycle, p.period * 1000);
  playing = tone;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  playing = null;
}

export function updateRinger(s: CallState) {
  if (s.status === 'incoming') start('ringtone');
  else if (s.status === 'outgoing') start('ringback');
  else stop();
}
