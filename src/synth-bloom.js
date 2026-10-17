import { BLOOM_DURATION, createBloomScore } from './bloom-score.js';

// Original future funk / nu-disco composition; no samples or external recordings.
export function synthesizeBloom(sampleRate = 44100) {
  const length = Math.ceil(BLOOM_DURATION * sampleRate);
  const left = new Float32Array(length), right = new Float32Array(length);
  let seed = 90313;
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
  for (const event of createBloomScore()) {
    const { voice, time: start, velocity, duration, pan = 0 } = event;
    const frequency = hz(event.pitch);
    if (voice === 'kick') write(start, 0.3, t => {
      const phase = 2 * Math.PI * (50 * t + 90 * 0.02 * (1 - Math.exp(-t / 0.02)));
      return (Math.sin(phase) * Math.exp(-t * 15) + noise() * Math.exp(-t * 260) * 0.05) * Math.min(1, t * 1400) * 0.68;
    }, 0, velocity);
    if (voice === 'clap') {
      // Three quick noise bursts and a short room tail.
      let low = 0;
      write(start, 0.22, t => {
        low = low * 0.5 + noise() * 0.5;
        const burst = [0, 0.011, 0.022].reduce((sum, at) => sum + (t >= at ? Math.exp(-(t - at) * 160) : 0), 0);
        return low * (burst * 0.6 + Math.exp(-t * 18) * 0.45) * 0.3;
      }, 0.08, velocity);
    }
    if (voice === 'hat' || voice === 'shaker') {
      let low = 0, smooth = 0;
      const hat = voice === 'hat';
      write(start, hat ? 0.16 : 0.05, t => {
        smooth = smooth * 0.2 + noise() * 0.8; low = low * 0.6 + smooth * 0.4;
        return (smooth - low) * Math.exp(-t * (hat ? 22 : 90)) * Math.min(1, t * (hat ? 2000 : 400)) * (hat ? 0.11 : 0.07);
      }, pan, velocity);
    }
    if (voice === 'bass') write(start, duration, t => {
      // Plucky low synth: bright attack that quickly closes, like a slapped string.
      const phase = 2 * Math.PI * frequency * t, bright = Math.exp(-t * 28);
      const tone = Math.sin(phase) + Math.sin(phase * 2) * (0.25 + bright * 0.4) + Math.sin(phase * 3) * bright * 0.3;
      const envelope = Math.min(1, t / 0.004) * Math.exp(-t * 4) * Math.min(1, (duration - t) / 0.02);
      return Math.tanh(tone * 1.3) * envelope * 0.24;
    }, 0, velocity);
    if (voice === 'keys') for (const [i, interval] of event.chord.entries()) {
      // Electric piano: a sine carrier with a decaying 1:1 FM tine.
      const tone = hz(event.pitch + interval);
      write(start, duration + 0.2, t => {
        const phase = 2 * Math.PI * tone * t;
        const tine = Math.sin(phase + Math.sin(phase) * 1.6 * Math.exp(-t * 6));
        const envelope = Math.min(1, t / 0.003) * Math.exp(-t * 3.2) * Math.min(1, (duration + 0.2 - t) / 0.12);
        return (tine * 0.8 + Math.sin(phase * 2) * 0.1) * envelope * 0.04;
      }, pan + (i % 2 ? 0.25 : -0.25), velocity);
    }
    if (voice === 'lead') write(start, duration + 0.15, t => {
      const vibrato = Math.sin(2 * Math.PI * 6 * t) * 0.005 * Math.min(1, t * 5);
      const phase = 2 * Math.PI * frequency * (1 + vibrato) * t;
      const square = Math.sin(phase) + Math.sin(phase * 3) / 3 + Math.sin(phase * 5) / 5;
      const envelope = Math.min(1, t / 0.01) * Math.exp(-t * 2) * Math.max(0, Math.min(1, (duration + 0.15 - t) / 0.1));
      return square * envelope * 0.075;
    }, pan, velocity);
    if (voice === 'pad') write(start, duration, t => {
      const phase = 2 * Math.PI * frequency * t;
      const envelope = Math.min(1, t / 0.4) * Math.max(0, Math.min(1, (duration - t) / 0.5));
      return (Math.sin(phase) + Math.sin(phase * 1.004) * 0.5 + Math.sin(phase * 0.998) * 0.5) * envelope * 0.022;
    }, pan, velocity);
    if (voice === 'air' || voice === 'swell') {
      let low = 0;
      write(start, duration, t => {
        low = low * 0.92 + noise() * 0.08;
        const rise = voice === 'swell' ? (t / duration) ** 2 : Math.sin(Math.PI * t / duration) ** 2;
        return low * rise * Math.max(0, Math.min(1, (duration - t) / 0.02)) * (voice === 'swell' ? 0.2 : 0.045);
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
