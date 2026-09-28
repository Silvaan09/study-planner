// Check-off sounds, synthesized with the Web Audio API (no audio files). Muting is a per-machine UI preference in localStorage.
import type { CelebrationKind } from '../shared/progress';

const PREF_KEY = 'sound';
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One soft bell/glockenspiel note: sine partials, very short attack, exponential decay. */
function bell(ac: AudioContext, freq: number, at: number, duration: number, volume: number) {
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(volume, at + 0.006);
  out.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  out.connect(ac.destination);
  for (const [multiple, level] of [
    [1, 1],
    [2, 0.28],
    [3, 0.07],
  ]) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * multiple;
    const g = ac.createGain();
    g.gain.value = level;
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + duration + 0.05);
  }
}

const E6 = 1318.51;

/** The "ding" for checking off a lecture or exercise. `force` plays it even when muted (preview when unmuting). */
export function playDing(force = false): void {
  if (!force && !soundEnabled()) return;
  const ac = audio();
  if (!ac) return;
  bell(ac, E6, ac.currentTime + 0.005, 0.9, 0.16);
}

/** A rising chime after the ding when a celebration shows (bigger for a completed week). */
export function playCelebration(kind: CelebrationKind): void {
  if (!soundEnabled()) return;
  const ac = audio();
  if (!ac) return;
  // C6 E6 G6 (+ C7 for the whole week), starting just after the ding.
  const notes = kind === 'everything' ? [1046.5, 1318.51, 1567.98, 2093] : [1046.5, 1318.51, 1567.98];
  const start = ac.currentTime + 0.25;
  notes.forEach((f, i) => bell(ac, f, start + i * 0.09, i === notes.length - 1 ? 1.4 : 0.7, 0.12));
}
