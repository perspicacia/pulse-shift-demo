import { BEAT, DURATION, SONG } from './game.js';

// Original 40-bar composition, rendered in a worker so synthesis never blocks input.
export function synthesize(sampleRate = 44100) {
  const length = Math.ceil(DURATION * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let seed = 1957;
  const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  const hz = midi => 440 * 2 ** ((midi - 69) / 12);
  const write = (start, duration, sample, pan = 0) => {
    const first = Math.round(start * sampleRate);
    const frames = Math.min(Math.ceil(duration * sampleRate), length - first);
    const l = Math.sqrt((1 - pan) / 2), r = Math.sqrt((1 + pan) / 2);
    for (let i = 0; i < frames; i++) {
      const value = sample(i / sampleRate, i);
      left[first + i] += value * l;
      right[first + i] += value * r;
    }
  };
  const roots = [45, 41, 48, 43];
  const melody = [0, 7, 12, 10, 7, 3, 7, 10, 12, 7, 15, 12, 10, 7, 3, 7];
  for (let bar = 0; bar < SONG.bars; bar++) {
    const root = roots[Math.floor(bar / 2) % 4];
    const breakdown = bar >= 16 && bar < 20;
    const intro = bar < 4;
    const out = bar >= 36;
    const energy = out ? 0.65 : 1;
    for (let beat = 0; beat < 4; beat++) {
      const start = (bar * 4 + beat) * BEAT;
      if (!breakdown || beat === 0) {
        write(start, 0.36, t => {
          const phase = 2 * Math.PI * (49 * t + 95 * 0.021 * (1 - Math.exp(-t / 0.021)));
          return (Math.sin(phase) * Math.exp(-t * 14) + noise() * Math.exp(-t * 190) * 0.13) * 0.65 * energy;
        });
      }
      if (beat % 2 && !intro && !breakdown) {
        write(start, 0.18, t => (noise() * Math.exp(-t * 31) + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.25) * 0.26 * energy);
      }
      for (let half = 0; half < 2; half++) {
        let previous = 0;
        write(start + half * BEAT / 2, 0.09, t => {
          const n = noise(), high = n - previous; previous = n;
          return high * Math.exp(-t * (half ? 60 : 95)) * (breakdown ? 0.016 : 0.052) * energy;
        }, half ? 0.3 : -0.3);
        if (!breakdown && !intro) {
          const freq = hz(root - 12);
          write(start + half * BEAT / 2 + 0.003, BEAT * 0.44, t => {
            const phase = t * freq * 2 * Math.PI;
            return Math.tanh((Math.sin(phase) + Math.sin(phase * 2) * 0.3) * 1.4) * Math.min(1, t * 300) * Math.exp(-t * 14) * 0.18 * energy;
          });
        }
      }
    }
    // Wide detuned pad with a sidechain-shaped envelope.
    for (const interval of [0, 3, 7, 12]) {
      const frequency = hz(root + interval + 12);
      const padDuration = BEAT * 4 + 0.3;
      write(bar * 4 * BEAT, padDuration, t => {
        const attack = Math.min(1, t * 7), release = Math.min(1, (padDuration - t) * 5);
        const duck = intro || breakdown ? 1 : 0.35 + 0.65 * Math.min(1, (t % BEAT) / 0.18);
        return (Math.sin(2 * Math.PI * frequency * t) + Math.sin(2 * Math.PI * frequency * 1.003 * t) * 0.45) * attack * release * duck * 0.036 * energy;
      }, interval === 0 ? -0.5 : 0.5);
    }
    if (bar >= 2) for (let step = 0; step < 8; step++) {
      const frequency = hz(root + 24 + melody[(step + bar * 2) % melody.length]);
      const duration = BEAT * (breakdown ? 1.4 : 0.7);
      if (breakdown && step % 2) continue;
      const start = (bar * 4 + step / 2) * BEAT;
      const lead = t => {
        const phase = t * frequency * 2 * Math.PI;
        const envelope = Math.min(1, t * 220) * Math.exp(-t * (breakdown ? 5 : 9));
        return (Math.sin(phase) + Math.sin(phase * 2) * 0.2 + Math.sin(phase * 3) * 0.1) * envelope * 0.09 * energy;
      };
      write(start, duration, lead, step % 2 ? 0.2 : -0.2);
      write(start + BEAT * 0.75, duration, t => lead(t) * 0.24, step % 2 ? -0.7 : 0.7);
    }
  }
  for (let i = 0; i < length; i++) {
    const endFade = Math.min(1, (length - i) / sampleRate);
    left[i] = Math.tanh(left[i] * 1.35) * 0.82 * endFade;
    right[i] = Math.tanh(right[i] * 1.35) * 0.82 * endFade;
  }
  return { left, right, sampleRate };
}
