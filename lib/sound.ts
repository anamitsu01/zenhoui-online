"use client";

// Tiny synthesized sound effects (Web Audio, no audio files). Browsers only
// allow audio after a user gesture, so the context is created lazily and
// unlocked on the first pointer/key press.

export type SoundName =
  | "step"
  | "paint"
  | "dice"
  | "enclose"
  | "flag"
  | "chest"
  | "item"
  | "bomb"
  | "cave"
  | "bridge"
  | "myTurn"
  | "setEnd"
  | "ruins"
  | "ruinsGood"
  | "ruinsBad"
  | "win";

const MUTE_KEY = "zenhoui:muted";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // storage unavailable; the toggle still works for this page
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** Call once on mount: unlocks audio on the first user interaction. */
export function installAudioUnlock(): () => void {
  const unlock = () => audio();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
  return () => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
}

/** A short pitched tone with an attack/decay envelope. */
function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", vol = 0.5, slideTo?: number) {
  const a = ctx!;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(master!);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** A burst of filtered noise (thuds, rattles, splats). */
function noise(start: number, dur: number, filterFreq: number, vol = 0.4, q = 1) {
  const a = ctx!;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buffer = a.createBuffer(1, len, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterFreq;
  filter.Q.value = q;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(filter).connect(g).connect(master!);
  src.start(start);
}

const last: Partial<Record<SoundName, number>> = {};

export function play(name: SoundName, opts: { volume?: number } = {}) {
  if (muted) return;
  const a = audio();
  if (!a || a.state !== "running") return;
  const now = a.currentTime;
  // Don't stack the same sound within a few ms (e.g. many paints at once).
  if (last[name] !== undefined && now - last[name]! < 0.04) return;
  last[name] = now;
  const v = opts.volume ?? 1;

  switch (name) {
    case "step": // soft footfall
      noise(now, 0.07, 220, 0.5 * v, 1.5);
      tone(140, now, 0.08, "sine", 0.35 * v, 90);
      break;
    case "paint": // wet "peta"
      noise(now + 0.02, 0.06, 1800, 0.18 * v, 2);
      tone(520, now + 0.02, 0.09, "triangle", 0.18 * v, 330);
      break;
    case "dice": // rattle of a few hits
      for (let i = 0; i < 6; i++) noise(now + i * 0.055 + Math.random() * 0.02, 0.035, 2500 + Math.random() * 1500, 0.35 * v, 4);
      break;
    case "enclose": // rising arpeggio
      [523, 659, 784, 1047].forEach((f, i) => tone(f, now + i * 0.07, 0.25, "triangle", 0.32 * v));
      tone(1568, now + 0.3, 0.35, "sine", 0.18 * v);
      break;
    case "flag": // bright bell
      tone(1318, now, 0.6, "sine", 0.35 * v);
      tone(1976, now + 0.01, 0.5, "sine", 0.18 * v);
      tone(988, now + 0.18, 0.6, "sine", 0.25 * v);
      break;
    case "chest": // sparkle
      [880, 1175, 1480, 1760].forEach((f, i) => tone(f, now + i * 0.05, 0.18, "square", 0.08 * v));
      tone(2350, now + 0.22, 0.3, "sine", 0.15 * v);
      break;
    case "item": // whoosh up
      tone(300, now, 0.25, "sawtooth", 0.08 * v, 1200);
      noise(now, 0.2, 3000, 0.12 * v, 0.7);
      break;
    case "bomb": // boom
      noise(now, 0.6, 120, 0.9 * v, 0.6);
      tone(90, now, 0.5, "sine", 0.6 * v, 35);
      break;
    case "cave": // hollow echo
      tone(196, now, 0.35, "sine", 0.3 * v, 150);
      tone(196, now + 0.2, 0.35, "sine", 0.12 * v, 150);
      break;
    case "bridge": // wooden knocks
      [0, 0.12, 0.24].forEach((t) => {
        noise(now + t, 0.06, 600, 0.45 * v, 3);
        tone(260, now + t, 0.07, "triangle", 0.2 * v);
      });
      break;
    case "myTurn": // two-note chime
      tone(784, now, 0.25, "sine", 0.3 * v);
      tone(1175, now + 0.12, 0.35, "sine", 0.3 * v);
      break;
    case "setEnd": // short jingle
      [659, 784, 988].forEach((f, i) => tone(f, now + i * 0.1, 0.3, "triangle", 0.25 * v));
      break;
    case "ruins": // ancient hum as the stones wake
      tone(110, now, 0.9, "sine", 0.35 * v, 140);
      tone(165, now + 0.05, 0.8, "triangle", 0.12 * v, 210);
      noise(now, 0.5, 400, 0.08 * v, 0.5);
      break;
    case "ruinsGood": // blessing chime
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, now + i * 0.06, 0.4, "sine", 0.22 * v));
      break;
    case "ruinsBad": // ominous drop
      tone(330, now, 0.5, "sawtooth", 0.1 * v, 110);
      tone(220, now + 0.12, 0.6, "triangle", 0.18 * v, 80);
      break;
    case "win": // fanfare
      [523, 523, 523, 698, 880, 1047].forEach((f, i) => tone(f, now + [0, 0.12, 0.24, 0.4, 0.6, 0.8][i], i === 5 ? 0.8 : 0.18, "square", 0.12 * v));
      break;
  }
}

/** A tiny buzz on phones that support it (Android). */
export function buzz(ms = 12) {
  if (muted) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
}
