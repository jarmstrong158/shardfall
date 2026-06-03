// Tiny WebAudio blip synth — no asset files needed. Throttled so the swarm
// doesn't produce a wall of noise. Created lazily on first user gesture.

let ctx = null;
let master = null;
let muted = false;
const lastPlayed = {}; // per-type rate limiting

function ensure() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}

export function resume() {
  ensure();
  if (ctx && ctx.state === "suspended") ctx.resume();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.18;
}

// type: stable key for throttling. freq Hz, dur seconds, wave shape.
function blip(type, freq, dur, wave, gain, minGap) {
  if (!ctx || muted) return;
  const now = ctx.currentTime;
  if (minGap && lastPlayed[type] && now - lastPlayed[type] < minGap) return;
  lastPlayed[type] = now;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = wave;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g); g.connect(master);
  o.start(now); o.stop(now + dur);
}

export const sfx = {
  mine: () => blip("mine", 180 + Math.random() * 50, 0.06, "square", 0.5, 0.04),
  deposit: () => blip("dep", 520 + Math.random() * 80, 0.07, "triangle", 0.6, 0.045),
  throwUp: () => blip("thr", 300, 0.05, "sawtooth", 0.35, 0.06),
  buy: () => { blip("buy", 660, 0.08, "square", 0.8, 0); setTimeout(() => blip("buy2", 990, 0.1, "square", 0.7, 0), 60); },
  layer: () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => blip("ly" + i, f, 0.22, "triangle", 0.8, 0), i * 90));
  },
  ascend: () => {
    [392, 523, 659, 784, 1046, 1318].forEach((f, i) =>
      setTimeout(() => blip("as" + i, f, 0.4, "triangle", 0.9, 0), i * 120));
  },
};
