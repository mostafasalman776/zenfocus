// All sounds are synthesized with Web Audio: nothing to host or hotlink.
// (Ported from the original ZenFocus chime and brown-noise generator.)

export type SoundId = 'rain' | 'brown' | 'waves' | 'white';

let ctx: AudioContext | null = null;
const playing = new Map<SoundId, { stop: () => void; gain: GainNode }>();

function audio(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBuffer(kind: 'white' | 'brown' | 'pink', seconds = 8): AudioBuffer {
  const c = audio();
  const buf = c.createBuffer(1, seconds * c.sampleRate, c.sampleRate);
  const out = buf.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') out[i] = w * 0.35;
    else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      out[i] = last * 3.5;
    } else {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
    }
  }
  return buf;
}

function loop(buffer: AudioBuffer, dest: AudioNode) {
  const src = audio().createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(dest);
  src.start();
  return src;
}

function build(id: SoundId, gain: GainNode): () => void {
  const c = audio();
  if (id === 'brown') {
    const s = loop(noiseBuffer('brown'), gain);
    return () => s.stop();
  }
  if (id === 'white') {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    lp.connect(gain);
    const s = loop(noiseBuffer('white'), lp);
    return () => s.stop();
  }
  if (id === 'rain') {
    // Pink noise through a band-pass sounds like steady rain on a window.
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.6;
    bp.connect(gain);
    const s = loop(noiseBuffer('pink'), bp);
    return () => s.stop();
  }
  // Waves: brown noise swelling in and out every ~8 seconds.
  const swell = c.createGain();
  swell.gain.value = 0.5;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.12;
  const depth = c.createGain();
  depth.gain.value = 0.45;
  lfo.connect(depth).connect(swell.gain);
  swell.connect(gain);
  const s = loop(noiseBuffer('brown'), swell);
  lfo.start();
  return () => {
    s.stop();
    lfo.stop();
  };
}

export function setSound(id: SoundId, on: boolean, volume: number) {
  const current = playing.get(id);
  if (on && !current) {
    const gain = audio().createGain();
    gain.gain.value = volume;
    gain.connect(audio().destination);
    playing.set(id, { stop: build(id, gain), gain });
  } else if (!on && current) {
    current.stop();
    current.gain.disconnect();
    playing.delete(id);
  }
}

export function setVolume(id: SoundId, volume: number) {
  const p = playing.get(id);
  if (p) p.gain.gain.setTargetAtTime(volume, audio().currentTime, 0.05);
}

export function playChime() {
  const c = audio();
  const now = c.currentTime;
  const g = c.createGain();
  g.gain.setValueAtTime(0.001, now);
  g.gain.linearRampToValueAtTime(0.2, now + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, now + 2);
  g.connect(c.destination);
  const a = c.createOscillator();
  a.type = 'triangle';
  a.frequency.setValueAtTime(523.25, now);
  a.frequency.exponentialRampToValueAtTime(880, now + 0.15);
  const b = c.createOscillator();
  b.type = 'sine';
  b.frequency.setValueAtTime(659.25, now);
  for (const o of [a, b]) {
    o.connect(g);
    o.start(now);
    o.stop(now + 2.1);
  }
}
