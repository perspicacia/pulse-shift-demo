import { MIRAGE_BEAT, MIRAGE_DURATION, createMirageScore } from './mirage-score.js';

// Original dream-lounge synthesis: no recordings, sample packs, or vocals.
export function synthesizeMirage(sampleRate = 44100) {
  const length = Math.ceil(MIRAGE_DURATION * sampleRate);
  const left = new Float32Array(length), right = new Float32Array(length);
  const spaceLeft = new Float32Array(length), spaceRight = new Float32Array(length);
  const tau = 2 * Math.PI, hz = midi => 440 * 2 ** ((midi - 69) / 12);
  let seed = 926813;
  const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  const write = (start, duration, sample, pan = 0, level = 1, send = 0) => {
    const first = Math.round(start * sampleRate), frames = Math.min(Math.ceil(duration * sampleRate), length - first);
    const l = Math.sqrt((1 - pan) / 2) * level, r = Math.sqrt((1 + pan) / 2) * level;
    for (let index = 0; index < frames; index++) {
      const value = sample(index / sampleRate), frame = first + index;
      left[frame] += value * l; right[frame] += value * r;
      if (send) { spaceLeft[frame] += value * l * send; spaceRight[frame] += value * r * send; }
    }
  };
  for (const event of createMirageScore()) {
    const { voice, time, velocity, duration, pan = 0 } = event, frequency = hz(event.pitch);
    if (voice === 'kick') write(time, 0.32, t => {
      const phase = tau * (43 * t + 48 * 0.027 * (1 - Math.exp(-t / 0.027)));
      return (Math.sin(phase) * Math.exp(-t * 14) + noise() * Math.exp(-t * 210) * 0.024) * Math.min(1, t * 1100) * 0.62;
    }, 0, velocity);
    if (voice === 'dum' || voice === 'tak') {
      let low = 0, smoother = 0;
      const lowHand = voice === 'dum', seconds = lowHand ? 0.23 : 0.13;
      write(time, seconds, t => {
        const n = noise(); smoother = smoother * 0.45 + n * 0.55; low = low * 0.83 + smoother * 0.17;
        const pitchFall = frequency * t + (lowHand ? 24 : 36) * 0.012 * (1 - Math.exp(-t / 0.012));
        const membrane = Math.sin(tau * pitchFall) * Math.exp(-t * (lowHand ? 17 : 36)) + Math.sin(tau * frequency * 1.53 * t) * Math.exp(-t * 42) * 0.26;
        const skin = (smoother - low) * Math.exp(-t * 60) * (lowHand ? 0.24 : 0.72);
        return (membrane + skin) * Math.min(1, t * 1400) * (lowHand ? 0.28 : 0.2);
      }, pan, velocity, 0.14);
    }
    if (voice === 'shaker') {
      let low = 0, smooth = 0;
      write(time, 0.072, t => {
        smooth = smooth * 0.55 + noise() * 0.45; low = low * 0.8 + smooth * 0.2;
        return (smooth - low) * Math.sin(Math.PI * Math.min(1, t / 0.072)) ** 2 * Math.exp(-t * 32) * 0.11;
      }, pan, velocity, 0.07);
    }
    if (voice === 'bass') write(time, duration, t => {
      const phase = tau * frequency * t;
      const envelope = Math.min(1, t / 0.012) * Math.exp(-t * 4.2) * Math.max(0, Math.min(1, (duration - t) / 0.045));
      return (Math.sin(phase) + Math.sin(phase * 2) * 0.14 + Math.sin(phase * 3) * Math.exp(-t * 16) * 0.08) * envelope * 0.23;
    }, 0, velocity);
    if (voice === 'pluck') write(time, duration, t => {
      const phase = tau * frequency * t;
      const body = Math.sin(phase + Math.sin(phase * 2) * Math.exp(-t * 16) * 0.7);
      const envelope = (1 - Math.exp(-t * 270)) * Math.exp(-t * 6.5) * Math.max(0, Math.min(1, (duration - t) / 0.07));
      return (body * 0.8 + Math.sin(phase * 0.5) * 0.2) * envelope * 0.14;
    }, pan, velocity, 0.6);
    if (voice === 'flute') {
      let breath = 0;
      write(time, duration, t => {
        breath = breath * 0.86 + noise() * 0.14;
        const vibrato = Math.sin(tau * 4.4 * t) * Math.min(0.055, t * 0.11);
        const phase = tau * frequency * t + vibrato - 0.13 * Math.exp(-t * 19);
        const envelope = Math.min(1, t / 0.028) * Math.exp(-t * 0.52) * Math.max(0, Math.min(1, (duration - t) / 0.16));
        const tone = Math.sin(phase) + Math.sin(phase * 2) * 0.2 + Math.sin(phase * 3) * 0.07;
        return (tone + breath * 0.15) * envelope * 0.13;
      }, pan, velocity, 0.68);
    }
    if (voice === 'pad' || voice === 'drone') write(time, duration, t => {
      const envelope = Math.min(1, t / 1.1) * Math.max(0, Math.min(1, (duration - t) / 1.5));
      const phase = tau * frequency * t, breathe = 0.84 + Math.sin(t * 0.64 + event.pitch) * 0.16;
      if (voice === 'drone') return (Math.sin(phase) + Math.sin(phase * 2) * 0.12) * envelope * breathe * 0.043;
      return (Math.sin(phase * 0.9988) + Math.sin(phase * 1.0012) * 0.55 + Math.sin(phase * 0.5) * 0.22) * envelope * breathe * 0.031;
    }, pan, velocity, voice === 'drone' ? 0.1 : 0.34);
    if (voice === 'air' || voice === 'swell') {
      let low = 0;
      write(time, duration, t => {
        low = low * 0.965 + noise() * 0.035;
        const contour = voice === 'swell' ? (t / duration) ** 2 : Math.sin(Math.PI * t / duration) ** 2;
        return low * contour * Math.max(0, Math.min(1, (duration - t) / 0.06)) * (voice === 'swell' ? 0.12 : 0.04);
      }, pan, velocity, 0.4);
    }
  }
  const taps = [[0.65 * MIRAGE_BEAT, 0.25], [1.3 * MIRAGE_BEAT, 0.18], [2.1 * MIRAGE_BEAT, 0.1], [2.9 * MIRAGE_BEAT, 0.065]].map(([seconds, gain]) => [Math.round(seconds * sampleRate), gain]);
  for (let index = 0; index < length; index++) {
    for (const [delay, gain] of taps) if (index >= delay) {
      left[index] += spaceRight[index - delay] * gain;
      right[index] += spaceLeft[index - delay] * gain;
    }
    const fade = Math.min(1, index / (sampleRate * 0.035), (length - 1 - index) / (sampleRate * 2));
    left[index] = Math.tanh(left[index] * 1.6) * 0.83 * fade;
    right[index] = Math.tanh(right[index] * 1.6) * 0.83 * fade;
  }
  return { left, right, sampleRate };
}
