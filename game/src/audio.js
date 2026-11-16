// audio.js — every sound is synthesized with WebAudio: no sound files. A short
// noise burst through a low-pass filter is a gunshot; an oscillator slide is a
// reload click, a hit tick or a round stinger. Mute is a master gain.

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.5;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } catch (e) {
    ctx = null;
  }
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
}
export function isMuted() { return muted; }

function noise(dur, filterFreq, gain, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.value = filterFreq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

function tone(freq0, freq1, dur, type, gain, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, freq1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  shot(weapon) {
    if (!ctx) return;
    if (weapon === 'sniper') { noise(0.28, 900, 0.9); tone(160, 40, 0.25, 'sine', 0.7); }
    else if (weapon === 'rifle') { noise(0.14, 1400, 0.7); tone(220, 70, 0.1, 'square', 0.25); }
    else if (weapon === 'smg') { noise(0.09, 1800, 0.5); }
    else { noise(0.12, 1200, 0.6); tone(200, 80, 0.08, 'square', 0.2); }
  },
  dryfire() { tone(1200, 900, 0.05, 'square', 0.15); },
  reload() { tone(500, 700, 0.06, 'square', 0.2); tone(700, 500, 0.06, 'square', 0.2, 0.12); },
  hit(headshot) { tone(headshot ? 1400 : 1000, headshot ? 900 : 700, 0.07, 'sine', 0.35); },
  kill() { tone(660, 660, 0.09, 'sine', 0.35); tone(990, 990, 0.12, 'sine', 0.3, 0.09); },
  hurt() { noise(0.15, 500, 0.5); tone(140, 60, 0.18, 'sawtooth', 0.3); },
  footstep() { noise(0.05, 400, 0.12); },
  throw_() { noise(0.1, 800, 0.3); },
  explosion() { noise(0.7, 300, 1.0); tone(90, 25, 0.6, 'sine', 0.9); },
  buy() { tone(880, 880, 0.07, 'sine', 0.3); tone(1320, 1320, 0.1, 'sine', 0.25, 0.07); },
  roundStart() { tone(440, 440, 0.1, 'square', 0.2); tone(660, 660, 0.14, 'square', 0.2, 0.1); },
  roundWin() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.35, i * 0.11)); },
  roundLose() { [392, 330, 262, 196].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.3, i * 0.12)); },
  click() { tone(800, 800, 0.04, 'square', 0.15); },
};
