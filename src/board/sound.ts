// Mechanical flap clatter, synthesized with Web Audio — no samples needed.
// Each flap step asks for a click; a rate limiter turns hundreds of
// simultaneous flips into a dense-but-bounded cascade instead of noise.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = false;
let volume = 0.4;
let lastClick = 0;

export function configureSound(on: boolean, vol: number) {
  enabled = on;
  volume = Math.max(0, Math.min(1, vol));
  if (master) master.gain.value = volume;
  if (on) ensureContext();
}

function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // browsers gate audio behind a user gesture; retry on any interaction
    const resume = () => {
      if (ctx && ctx.state === 'suspended') void ctx.resume();
    };
    for (const ev of ['pointerdown', 'keydown', 'mousemove', 'touchstart']) {
      window.addEventListener(ev, resume, { passive: true });
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/** Called by each cell on every flap step. */
export function flap() {
  if (!enabled) return;
  ensureContext();
  if (!ctx || !master || !noise || ctx.state !== 'running') return;

  const now = performance.now();
  if (now - lastClick < 9) return; // cap click density during full-board flips
  lastClick = now;

  const t = ctx.currentTime;
  const dur = 0.015 + Math.random() * 0.012;

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.5;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1600 + Math.random() * 2600;
  bp.Q.value = 1.4;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18 + Math.random() * 0.14, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);

  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.01);
}
