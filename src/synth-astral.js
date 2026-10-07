import { ASTRAL_BEAT, ASTRAL_DURATION, createAstralScore } from './astral-score.js';

// Original dark electro: dry drums and bass, a wide, floating synth atmosphere.
export function synthesizeAstral(sampleRate = 44100) {
  const length = Math.ceil(ASTRAL_DURATION * sampleRate);
  const left = new Float32Array(length), right = new Float32Array(length);
  const spaceL = new Float32Array(length), spaceR = new Float32Array(length);
  const tau = 2 * Math.PI, hz = midi => 440 * 2 ** ((midi - 69) / 12);
  let seed = 481903;
  const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  const write = (start, duration, sample, pan = 0, level = 1, send = 0) => {
    const first = Math.round(start * sampleRate), frames = Math.min(Math.ceil(duration * sampleRate), length - first);
    const l = Math.sqrt((1 - pan) / 2) * level, r = Math.sqrt((1 + pan) / 2) * level;
    for (let i = 0; i < frames; i++) {
      const value = sample(i / sampleRate), frame = first + i;
      left[frame] += value * l; right[frame] += value * r;
      if (send) { spaceL[frame] += value * l * send; spaceR[frame] += value * r * send; }
    }
  };
  for (const event of createAstralScore()) {
    const { voice, time, velocity, duration, pan = 0 } = event, frequency = hz(event.pitch);
    if (voice === 'kick') write(time, 0.32, t => {
      const phase = tau * (48 * t + 85 * 0.018 * (1 - Math.exp(-t / 0.018)));
      return (Math.sin(phase) * Math.exp(-t * 16) + noise() * Math.exp(-t * 280) * 0.035) * Math.min(1, t * 1600) * 0.72;
    }, 0, velocity);
    if (voice === 'snare') {
      let low = 0, body = 0;
      write(time, 0.18, t => {
        low = low * 0.35 + noise() * 0.65; body = body * 0.86 + low * 0.14;
        const clap = (low - body) * (Math.exp(-t * 34) + Math.exp(-Math.abs(t - 0.014) * 180) * 0.3);
        return (clap + Math.sin(tau * 178 * t) * Math.exp(-t * 48) * 0.24) * Math.min(1, t * 1400) * 0.3;
      }, 0.05, velocity);
    }
    if (voice === 'hat') {
      let low = 0;
      write(time, event.open ? 0.14 : 0.05, t => {
        const n = noise(); low = low * 0.74 + n * 0.26;
        return (n - low) * Math.exp(-t * (event.open ? 28 : 115)) * Math.min(1, t * 1500) * 0.09;
      }, pan, velocity);
    }
    if (voice === 'bass') write(time, duration, t => {
      const phase = tau * frequency * t, brightness = Math.exp(-t * 21);
      const tone = Math.sin(phase) + Math.sin(phase * 2) * 0.32 + Math.sin(phase * 3) * 0.21 * brightness + Math.sin(phase * 4) * 0.13 * brightness;
      const envelope = Math.min(1, t / 0.006) * Math.exp(-t * 5) * Math.max(0, Math.min(1, (duration - t) / 0.026));
      return Math.tanh(tone * 1.5) * envelope * 0.25;
    }, 0, velocity);
    if (voice === 'arp') write(time, duration, t => {
      const phase = tau * frequency * t;
      const bell = Math.sin(phase + Math.sin(phase * 2) * 1.65 * Math.exp(-t * 18));
      return (bell * 0.7 + Math.sin(phase * 0.5) * 0.3) * (1 - Math.exp(-t * 350)) * Math.exp(-t * 8) * Math.max(0, Math.min(1, (duration - t) / 0.05)) * 0.12;
    }, pan, velocity, 0.55);
    if (voice === 'lead') write(time, duration, t => {
      const phase = tau * frequency * t + Math.sin(t * 32) * Math.min(0.12, t * 0.3);
      const envelope = Math.min(1, t / 0.025) * Math.exp(-t * 2.8) * Math.max(0, Math.min(1, (duration - t) / 0.12));
      return (Math.sin(phase) + Math.sin(phase * 2) * 0.22 + Math.sin(phase * 3) * 0.11) * envelope * 0.11;
    }, pan, velocity, 0.7);
    if (voice === 'pad' || voice === 'choir') write(time, duration, t => {
      const phase = tau * frequency * t;
      const envelope = Math.min(1, t / (voice === 'choir' ? 1.4 : 0.8)) * Math.max(0, Math.min(1, (duration - t) / 1.4));
      const pulse = 0.64 + 0.36 * Math.min(1, (t % ASTRAL_BEAT) / 0.15);
      if (voice === 'choir') {
        const vowels = Math.sin(phase + Math.sin(t * 4.8) * 0.045) + Math.sin(phase * 2) * 0.28 + Math.sin(phase * 3) * 0.16;
        return vowels * envelope * (0.85 + 0.15 * Math.sin(t * 0.65)) * 0.018;
      }
      return (Math.sin(phase * 0.9985) + Math.sin(phase * 1.0015) * 0.6 + Math.sin(phase * 0.5) * 0.25) * envelope * pulse * 0.031;
    }, pan, velocity, voice === 'choir' ? 0.65 : 0.35);
    if (voice === 'air' || voice === 'swell') {
      let low = 0;
      write(time, duration, t => {
        low = low * 0.93 + noise() * 0.07;
        const contour = voice === 'swell' ? (t / duration) ** 2 : Math.sin(Math.PI * t / duration) ** 2;
        return low * contour * Math.max(0, Math.min(1, (duration - t) / 0.04)) * (voice === 'swell' ? 0.19 : 0.05);
      }, pan, velocity, 0.35);
    }
  }
  const taps = [[0.375 * ASTRAL_BEAT, 0.33], [0.75 * ASTRAL_BEAT, 0.24], [1.25 * ASTRAL_BEAT, 0.15], [2.125 * ASTRAL_BEAT, 0.09]].map(([seconds, gain]) => [Math.round(seconds * sampleRate), gain]);
  for (let i = 0; i < length; i++) {
    for (const [delay, gain] of taps) if (i >= delay) {
      left[i] += spaceR[i - delay] * gain; right[i] += spaceL[i - delay] * gain;
    }
    const fade = Math.min(1, i / (sampleRate * 0.04), (length - 1 - i) / (sampleRate * 1.7));
    left[i] = Math.tanh(left[i] * 1.7) * 0.84 * fade;
    right[i] = Math.tanh(right[i] * 1.7) * 0.84 * fade;
  }
  return { left, right, sampleRate };
}
