import { PRISM_BEAT, PRISM_DURATION, createPrismScore } from './prism-score.js';

// Original liquid drum & bass composition; no samples or external recordings.
export function synthesizePrism(sampleRate = 44100) {
  const length = Math.ceil(PRISM_DURATION * sampleRate);
  const left = new Float32Array(length), right = new Float32Array(length);
  let seed = 51877;
  const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  const hz = midi => 440 * 2 ** ((midi - 69) / 12);
  const saw = (phase, harmonics) => { let sum = 0; for (let k = 1; k <= harmonics; k++) sum += Math.sin(phase * k) / k; return sum * 0.55; };
  const write = (start, duration, sample, pan = 0, level = 1) => {
    const first = Math.round(start * sampleRate), frames = Math.min(Math.ceil(duration * sampleRate), length - first);
    const l = Math.sqrt((1 - pan) / 2) * level, r = Math.sqrt((1 + pan) / 2) * level;
    for (let i = 0; i < frames; i++) {
      const value = sample(i / sampleRate, i);
      left[first + i] += value * l; right[first + i] += value * r;
    }
  };
  for (const event of createPrismScore()) {
    const { voice, time: start, velocity, duration, pan = 0 } = event;
    const frequency = hz(event.pitch);
    if (voice === 'kick') write(start, 0.26, t => {
      const phase = 2 * Math.PI * (52 * t + 110 * 0.014 * (1 - Math.exp(-t / 0.014)));
      return (Math.sin(phase) * Math.exp(-t * 20) + noise() * Math.exp(-t * 300) * 0.06) * Math.min(1, t * 1500) * 0.7;
    }, 0, velocity);
    if (voice === 'snare' || voice === 'ghost') {
      let low = 0, bottom = 0;
      const ghost = voice === 'ghost';
      write(start, ghost ? 0.07 : 0.2, t => {
        low = low * 0.35 + noise() * 0.65; bottom = bottom * 0.9 + low * 0.1;
        const body = Math.sin(2 * Math.PI * 205 * t) * Math.exp(-t * 45) * 0.32;
        return ((low - bottom) * Math.exp(-t * (ghost ? 70 : 24)) + body) * Math.min(1, t * 1200) * 0.38;
      }, ghost ? -0.15 : 0.05, velocity);
    }
    if (voice === 'hat') {
      let low = 0, smooth = 0;
      write(start, event.open ? 0.13 : 0.035, t => {
        smooth = smooth * 0.25 + noise() * 0.75; low = low * 0.65 + smooth * 0.35;
        return (smooth - low) * Math.exp(-t * (event.open ? 30 : 150)) * Math.min(1, t * 2000) * 0.14;
      }, pan, velocity);
    }
    if (voice === 'bass') {
      // Reese: two detuned saws through a slowly moving one-pole filter.
      let filtered = 0;
      write(start, duration, t => {
        const raw = saw(2 * Math.PI * frequency * 0.996 * t, 7) + saw(2 * Math.PI * frequency * 1.004 * t, 7);
        const cutoff = 0.05 + 0.04 * Math.sin(2 * Math.PI * 1.4 * (start + t));
        filtered += cutoff * (raw - filtered);
        const envelope = Math.min(1, t / 0.01) * Math.min(1, (duration - t) / 0.02);
        return Math.tanh(filtered * 1.6 + Math.sin(2 * Math.PI * frequency * t) * 0.5) * envelope * 0.2;
      }, 0, velocity);
    }
    if (voice === 'stab') for (const [i, interval] of event.chord.entries()) {
      const tone = hz(event.pitch + interval);
      write(start, duration + 0.12, t => {
        const envelope = Math.min(1, t / 0.004) * Math.exp(-t * 9) * Math.min(1, (duration + 0.12 - t) / 0.05);
        return saw(2 * Math.PI * tone * t, 5) * envelope * 0.045;
      }, pan + (i % 2 ? 0.2 : -0.2), velocity);
    }
    if (voice === 'arp') {
      const pluck = t => {
        const phase = 2 * Math.PI * frequency * t;
        const envelope = (1 - Math.exp(-t * 300)) * Math.exp(-t * 8) * Math.max(0, Math.min(1, (duration - t) / 0.06));
        return (Math.sin(phase + Math.sin(phase * 2) * 1.2 * Math.exp(-t * 10)) * 0.7 + Math.sin(phase * 2) * 0.15) * envelope * 0.07;
      };
      write(start, duration, pluck, pan, velocity);
      write(start + PRISM_BEAT * 0.75, duration, pluck, -pan, velocity * 0.25);
    }
    if (voice === 'lead') write(start, duration + 0.25, t => {
      const vibrato = Math.sin(2 * Math.PI * 5.5 * t) * 0.004 * Math.min(1, t * 4);
      const phase = 2 * Math.PI * frequency * (1 + vibrato) * t;
      const envelope = Math.min(1, t / 0.012) * Math.exp(-t * 2.5) * Math.max(0, Math.min(1, (duration + 0.25 - t) / 0.2));
      return (Math.sin(phase) + Math.sin(phase * 2) * 0.25 + Math.sin(phase * 3) * 0.12) * envelope * 0.085;
    }, 0.1, velocity);
    if (voice === 'pad') write(start, duration, t => {
      const phase = 2 * Math.PI * frequency * t;
      const envelope = Math.min(1, t / 0.6) * Math.max(0, Math.min(1, (duration - t) / 0.8));
      return (Math.sin(phase) + Math.sin(phase * 1.003) * 0.6 + Math.sin(phase * 2.001) * 0.15) * envelope * 0.03;
    }, pan, velocity);
    if (voice === 'air' || voice === 'swell') {
      let low = 0;
      write(start, duration, t => {
        low = low * 0.93 + noise() * 0.07;
        const rise = voice === 'swell' ? (t / duration) ** 2 : Math.sin(Math.PI * t / duration) ** 2;
        return low * rise * Math.max(0, Math.min(1, (duration - t) / 0.02)) * (voice === 'swell' ? 0.24 : 0.05);
      }, voice === 'swell' ? 0 : pan, velocity);
    }
  }
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / (sampleRate * 0.04), (length - 1 - i) / (sampleRate * 1.5));
    left[i] = Math.tanh(left[i] * 1.6) * 0.82 * fade;
    right[i] = Math.tanh(right[i] * 1.6) * 0.82 * fade;
  }
  return { left, right, sampleRate };
}
