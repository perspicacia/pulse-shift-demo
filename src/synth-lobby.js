export const LOBBY_BPM = 128;
export const LOBBY_DURATION = 16 * 4 * 60 / LOBBY_BPM;

// NEON HALO: an original cyber-pop loop. All voices, including the vowel-like
// digital choir, are synthesized here; no recordings or vocal samples are used.
export function synthesizeLobby(sampleRate = 44100) {
  const length = Math.round(LOBBY_DURATION * sampleRate);
  const left = new Float32Array(length), right = new Float32Array(length);
  const beat = 60 / LOBBY_BPM, tau = Math.PI * 2;
  let seed = 700128;
  const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  const hz = midi => 440 * 2 ** ((midi - 69) / 12);
  // Wrap release tails and echoes into the start, so every repeat is seamless.
  const write = (start, duration, voice, pan = 0) => {
    const first = Math.round(start * sampleRate), frames = Math.ceil(duration * sampleRate);
    const l = Math.sqrt((1 - pan) / 2), r = Math.sqrt((1 + pan) / 2);
    for (let i = 0; i < frames; i++) {
      const index = ((first + i) % length + length) % length;
      const value = voice(i / sampleRate) * Math.min(1, i / (sampleRate * 0.002), (frames - 1 - i) / (sampleRate * 0.004));
      left[index] += value * l; right[index] += value * r;
    }
  };
  const roots = [38, 34, 43, 45];
  const chords = [[0, 3, 7, 10, 14], [0, 4, 7, 11, 14], [0, 3, 7, 10, 14], [0, 3, 7, 10, 14]];
  const arp = [0, 7, 14, 10, 3, 14, 7, 17];
  const choirNotes = [74, 77, 76, 72, 70, 74, 69, 72];
  for (let bar = 0; bar < 16; bar++) {
    const chord = Math.floor(bar / 2) % 4, root = roots[chord], start = bar * beat * 4;
    const open = bar >= 8, energy = bar === 7 || bar === 15 ? 0.75 : 1;
    // Wide, gently breathing suspended pad.
    if (bar % 2 === 0) chords[chord].forEach((interval, index) => {
      const frequency = hz(root + interval + 24), duration = beat * 8 + 0.7;
      write(start, duration, t => {
        const envelope = Math.min(1, t / 0.3, (duration - t) / 0.7);
        const breath = 0.6 + 0.4 * Math.min(1, (t % beat) / 0.21);
        const wave = Math.sin(tau * frequency * t) + 0.35 * Math.sin(tau * frequency * 1.002 * t + 0.4);
        return wave * envelope * breath * 0.04;
      }, (index - 2) * 0.35);
    });
    const kickSteps = open ? [0, 1.5, 2, 2.75, 3.5] : [0, 1.75, 2.5];
    for (const step of kickSteps) write(start + step * beat, 0.3, t => {
      const phase = tau * (47 * t + 78 * 0.022 * (1 - Math.exp(-t / 0.022)));
      return (Math.sin(phase) * Math.exp(-t * 17) + noise() * Math.exp(-t * 220) * 0.1) * 0.58 * energy;
    });
    for (const step of [1, 3]) write(start + step * beat, 0.19, t => {
      const clicks = Math.exp(-t * 90) + 0.5 * Math.exp(-Math.abs(t - 0.012) * 160) + 0.35 * Math.exp(-Math.abs(t - 0.025) * 150);
      return (noise() * clicks * 0.12 + Math.sin(tau * 178 * t) * Math.exp(-t * 35) * 0.085) * energy;
    }, -0.08);
    for (let step = 0; step < 16; step++) {
      if (step % 2 && !open && step % 4 !== 3) continue;
      let previous = 0;
      write(start + step * beat / 4, step % 4 === 2 ? 0.11 : 0.055, t => {
        const n = noise(), high = n - previous; previous = n;
        return high * Math.exp(-t * (step % 4 === 2 ? 38 : 100)) * (step % 2 ? 0.017 : 0.027);
      }, step % 2 ? 0.55 : -0.4);
    }
    for (const step of [0.25, 0.75, 1.5, 2.25, 2.75, 3.25, 3.75]) {
      const frequency = hz(root + (step === 3.75 ? 12 : 0));
      write(start + step * beat, beat * 0.45, t => {
        const phase = tau * frequency * t;
        return (Math.sin(phase) + 0.24 * Math.sin(phase * 2) + 0.09 * Math.sin(phase * 3)) * Math.min(1, t / 0.008) * Math.exp(-t * 13) * 0.24 * energy;
      });
    }
    // Glassy FM arpeggio, with a different answer in the second half.
    for (let step = 0; step < 8; step++) {
      const interval = arp[(step + (open ? 3 : 0) + bar % 2) % arp.length];
      const frequency = hz(root + 36 + interval), duration = beat * 0.75;
      const pluck = t => Math.sin(tau * frequency * t + 1.2 * Math.sin(tau * frequency * 2 * t) * Math.exp(-t * 14)) * Math.exp(-t * 11) * 0.065;
      const pan = step % 2 ? 0.45 : -0.45;
      write(start + step * beat / 2, duration, pluck, pan);
      write(start + (step / 2 + 0.75) * beat, duration, t => pluck(t) * 0.3, -pan);
    }
    // Short synthetic vowel tones: airy harmonics and a moving formant, no words.
    const choirFrequency = hz(choirNotes[Math.floor(bar / 2)]);
    for (const step of open ? [0.5, 1.25, 2.5, 3.25] : [0.5, 2.5]) {
      const duration = beat * (step % 1 === 0.5 ? 0.8 : 0.4);
      write(start + step * beat, duration, t => {
        const phase = tau * choirFrequency * t + 0.03 * Math.sin(tau * 6 * t);
        const vowel = Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.3 + Math.sin(phase * 3 + Math.sin(tau * 3 * t)) * 0.17;
        return vowel * Math.sin(Math.PI * t / duration) ** 2 * (open ? 0.13 : 0.095);
      }, bar % 2 ? 0.3 : -0.3);
    }
    if (bar % 4 === 3) for (let step = 0; step < 4; step++) {
      write(start + (3.5 + step / 8) * beat, 0.035, t => noise() * Math.exp(-t * 110) * 0.035, step % 2 ? 0.7 : -0.7);
    }
  }
  const dryLeft = left.slice(), dryRight = right.slice();
  const taps = [[beat * 0.75, 0.12], [beat * 1.5, 0.07], [beat * 2.25, 0.035]];
  let peak = 0;
  for (let i = 0; i < length; i++) {
    for (const [delay, amount] of taps) {
      const previous = (i - Math.round(delay * sampleRate) + length) % length;
      left[i] += dryRight[previous] * amount; right[i] += dryLeft[previous] * amount;
    }
    left[i] = Math.tanh(left[i] * 1.3); right[i] = Math.tanh(right[i] * 1.3);
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const gain = 0.78 / Math.max(0.78, peak);
  for (let i = 0; i < length; i++) { left[i] *= gain; right[i] *= gain; }
  return { left, right, sampleRate };
}
