import { SUNSET_BEAT, SUNSET_DURATION, createSunsetScore } from './sunset-score.js';

// Original instruments made from oscillators and seeded noise; no recordings or samples.
export function synthesizeSunset(sampleRate = 44100) {
  const length = Math.ceil(SUNSET_DURATION * sampleRate);
  const left = new Float32Array(length), right = new Float32Array(length);
  const spaceL = new Float32Array(length), spaceR = new Float32Array(length);
  const tau = 2 * Math.PI, hz = midi => 440 * 2 ** ((midi - 69) / 12);
  let seed = 1063409;
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
  const release = (time, duration, seconds) => Math.max(0, Math.min(1, (duration - time) / seconds));
  for (const event of createSunsetScore()) {
    const { voice, time, velocity, duration, pan = 0 } = event, frequency = hz(event.pitch);
    if (voice === 'kick') write(time, 0.33, t => {
      const phase = tau * (49 * t + 38 * 0.03 * (1 - Math.exp(-t / 0.03)));
      return (Math.sin(phase) * Math.exp(-t * 14) + noise() * Math.exp(-t * 210) * 0.025) * Math.min(1, t * 950) * 0.58;
    }, 0, velocity);
    if (voice === 'snare') {
      let low = 0, soft = 0;
      write(time, 0.21, t => {
        low = low * 0.76 + noise() * 0.24; soft = soft * 0.9 + low * 0.1;
        const brush = (low - soft) * (Math.exp(-t * 27) + 0.25 * Math.exp(-Math.abs(t - 0.022) * 130));
        const body = Math.sin(tau * 168 * t) * Math.exp(-t * 39) * 0.22;
        return (brush + body) * Math.min(1, t * 600) * 0.36;
      }, 0.04, velocity, 0.08);
    }
    if (voice === 'shaker') {
      let smooth = 0, low = 0;
      write(time, 0.078, t => {
        smooth = smooth * 0.7 + noise() * 0.3; low = low * 0.85 + smooth * 0.15;
        return (smooth - low) * Math.sin(Math.PI * Math.min(1, t / 0.075)) ** 2 * Math.exp(-t * 32) * 0.1;
      }, pan, velocity);
    }
    if (voice === 'rim') write(time, 0.055, t => {
      const body = Math.sin(tau * 680 * t) + Math.sin(tau * 1130 * t) * 0.35;
      return body * Math.min(1, t * 1400) * Math.exp(-t * 105) * 0.1;
    }, pan, velocity, 0.13);
    if (voice === 'bass') write(time, duration, t => {
      const phase = tau * frequency * t;
      const envelope = Math.min(1, t / 0.01) * Math.exp(-t * 3.8) * release(t, duration, 0.075);
      const fundamental = Math.sin(phase + Math.sin(phase * 2) * 0.08 * Math.exp(-t * 10));
      const wood = Math.sin(phase * 2) * 0.21 * Math.exp(-t * 8) + Math.sin(phase * 3) * 0.07 * Math.exp(-t * 17);
      return (fundamental + wood) * envelope * 0.25;
    }, 0, velocity);
    if (voice === 'keys') write(time, duration, t => {
      const phase = tau * frequency * t;
      const tine = Math.sin(phase + Math.sin(phase * 2) * 0.5 * Math.exp(-t * 5));
      const bell = Math.sin(phase * 3) * 0.1 * Math.exp(-t * 14);
      const envelope = (1 - Math.exp(-t * 260)) * Math.exp(-t * 2.6) * release(t, duration, 0.18);
      return (tine + bell + Math.sin(phase * 0.5) * 0.13) * envelope * (0.9 + Math.sin(t * 8.5) * 0.1) * 0.078;
    }, pan, velocity, 0.48);
    if (voice === 'lead') write(time, duration, t => {
      const phase = tau * frequency * t + Math.sin(t * 28) * Math.min(0.045, t * 0.1);
      const envelope = Math.min(1, t / 0.028) * Math.exp(-t * 2.1) * release(t, duration, 0.12);
      return (Math.sin(phase) + Math.sin(phase * 2) * 0.12) * envelope * 0.12;
    }, pan, velocity, 0.58);
    if (voice === 'pad') write(time, duration, t => {
      const phase = tau * frequency * t;
      const envelope = Math.min(1, t / 0.85) * release(t, duration, 0.85);
      return (Math.sin(phase * 0.999) + Math.sin(phase * 1.001) * 0.6) * envelope * (0.88 + Math.sin(t * 0.6) * 0.12) * 0.018;
    }, pan, velocity, 0.6);
    if (voice === 'sea' || voice === 'brush') {
      let low = 0;
      write(time, duration, t => {
        low = low * 0.975 + noise() * 0.025;
        const contour = voice === 'brush' ? Math.sin(Math.PI * t / duration) ** 2 : (0.5 - 0.5 * Math.cos(tau * t / duration)) ** 2;
        return low * contour * release(t, duration, 0.08) * (voice === 'brush' ? 0.13 : 0.08);
      }, pan, velocity, 0.4);
    }
  }
  const taps = [[0.75 * SUNSET_BEAT, 0.24], [1.5 * SUNSET_BEAT, 0.12], [0.113, 0.18], [0.167, 0.13], [0.263, 0.09]].map(([seconds, gain]) => [Math.round(seconds * sampleRate), gain]);
  let smoothL = 0, smoothR = 0;
  const tone = 1 - Math.exp(-tau * 6400 / sampleRate);
  for (let i = 0; i < length; i++) {
    for (const [delay, gain] of taps) if (i >= delay) {
      left[i] += spaceR[i - delay] * gain; right[i] += spaceL[i - delay] * gain;
    }
    smoothL += (left[i] - smoothL) * tone; smoothR += (right[i] - smoothR) * tone;
    const fade = Math.min(1, i / (sampleRate * 0.025), (length - 1 - i) / (sampleRate * 2));
    left[i] = Math.tanh(smoothL * 1.7) * 0.82 * fade;
    right[i] = Math.tanh(smoothR * 1.7) * 0.82 * fade;
  }
  return { left, right, sampleRate };
}
