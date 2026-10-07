import { TIDAL_BEAT, TIDAL_DURATION, createTidalScore } from './tidal-score.js';

// Original modular/broken-beat composition; no samples or external recordings.
export function synthesizeTidal(sampleRate = 44100) {
  const length = Math.ceil(TIDAL_DURATION * sampleRate);
  const left = new Float32Array(length), right = new Float32Array(length);
  let seed = 72391;
  const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  const hz = midi => 440 * 2 ** ((midi - 69) / 12);
  const write = (start, duration, sample, pan = 0, level = 1) => {
    const first = Math.round(start * sampleRate), frames = Math.min(Math.ceil(duration * sampleRate), length - first);
    const l = Math.sqrt((1 - pan) / 2) * level, r = Math.sqrt((1 + pan) / 2) * level;
    for (let i = 0; i < frames; i++) {
      const value = sample(i / sampleRate, i);
      left[first + i] += value * l; right[first + i] += value * r;
    }
  };
  for (const event of createTidalScore()) {
    const { voice, time: start, velocity, duration, pan = 0 } = event;
    const frequency = hz(event.pitch);
    if (voice === 'kick') write(start, 0.34, t => {
      const phase = 2 * Math.PI * (46 * t + 72 * 0.019 * (1 - Math.exp(-t / 0.019)));
      return (Math.sin(phase) * Math.exp(-t * 17) + noise() * Math.exp(-t * 240) * 0.04) * Math.min(1, t * 1400) * 0.67;
    }, 0, velocity);
    if (voice === 'snare' || voice === 'rim') {
      let low = 0, bottom = 0;
      write(start, voice === 'rim' ? 0.055 : 0.16, t => {
        low = low * 0.42 + noise() * 0.58; bottom = bottom * 0.92 + low * 0.08;
        const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 60) * 0.2;
        return ((low - bottom) * Math.exp(-t * (voice === 'rim' ? 95 : 35)) + body) * Math.min(1, t * 1100) * 0.34;
      }, voice === 'rim' ? -0.3 : 0.05, velocity);
    }
    if (voice === 'hat') {
      let low = 0, smooth = 0;
      write(start, event.open ? 0.12 : 0.04, t => {
        smooth = smooth * 0.3 + noise() * 0.7; low = low * 0.7 + smooth * 0.3;
        return (smooth - low) * Math.exp(-t * (event.open ? 34 : 130)) * Math.min(1, t * 1800) * 0.15;
      }, pan, velocity);
    }
    if (voice === 'bass') write(start, duration, t => {
      const phase = 2 * Math.PI * frequency * t;
      const envelope = Math.min(1, t / 0.012) * Math.exp(-t * 9) * Math.min(1, (duration - t) / 0.025);
      return Math.tanh(Math.sin(phase) * 1.2 + Math.sin(phase * 2) * 0.18) * envelope * 0.24;
    }, 0, velocity);
    if (voice === 'pluck') {
      const pluck = t => {
        const phase = 2 * Math.PI * frequency * t;
        const index = 2.8 * Math.exp(-t * 12);
        const fm = Math.sin(phase + Math.sin(phase * 1.501) * index);
        const envelope = (1 - Math.exp(-t * 230)) * Math.exp(-t * 7) * Math.max(0, Math.min(1, (duration - t) / 0.08));
        return (fm * 0.65 + Math.sin(phase) * 0.35) * envelope * 0.13;
      };
      write(start, duration, pluck, pan, velocity);
      write(start + TIDAL_BEAT * 0.75, duration, pluck, -pan * 2, velocity * 0.23);
      write(start + TIDAL_BEAT * 1.5, duration, pluck, pan * 2, velocity * 0.1);
    }
    if (voice === 'pad') write(start, duration, t => {
      const phase = 2 * Math.PI * frequency * t;
      const envelope = Math.min(1, t / 0.9) * Math.max(0, Math.min(1, (duration - t) / 1.1));
      const breathe = 0.85 + Math.sin(t * 0.9 + event.pitch) * 0.15;
      return (Math.sin(phase + Math.sin(phase * 0.5) * 0.35) + Math.sin(phase * 1.0018) * 0.45) * envelope * breathe * 0.035;
    }, pan, velocity);
    if (voice === 'air' || voice === 'swell') {
      let low = 0;
      write(start, duration, t => {
        low = low * 0.94 + noise() * 0.06;
        const rise = voice === 'swell' ? (t / duration) ** 2 : Math.sin(Math.PI * t / duration) ** 2;
        const release = Math.max(0, Math.min(1, (duration - t) / 0.02));
        return low * rise * release * (voice === 'swell' ? 0.22 : 0.06);
      }, voice === 'swell' ? 0 : -0.6, velocity);
    }
  }
  for (let i = 0; i < length; i++) {
    const fade = Math.min(1, i / (sampleRate * 0.04), (length - 1 - i) / (sampleRate * 1.5));
    left[i] = Math.tanh(left[i] * 1.6) * 0.82 * fade;
    right[i] = Math.tanh(right[i] * 1.6) * 0.82 * fade;
  }
  return { left, right, sampleRate };
}
