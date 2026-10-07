// Broad noise transients have no musical key to clash with the selected song.
// Bake the envelope and gentle band limits once, then reuse a tiny PCM buffer.
export function createPercussion(sampleRate, kind = 'hit') {
  const reward = kind === 'reward';
  const duration = reward ? 0.085 : 0.028;
  const data = new Float32Array(Math.ceil(sampleRate * duration));
  const lowPole = Math.exp(-2 * Math.PI * (reward ? 6200 : 3400) / sampleRate);
  const highPole = Math.exp(-2 * Math.PI * (reward ? 1500 : 420) / sampleRate);
  let seed = 0x2a4f173b, low = 0, bottom = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const white = (seed >>> 0) / 0xffffffff * 2 - 1;
    low = lowPole * low + (1 - lowPole) * white;
    bottom = highPole * bottom + (1 - highPole) * low;
    const time = i / sampleRate;
    const attack = 1 - Math.exp(-time / (reward ? 0.003 : 0.0007));
    const decay = Math.exp(-time / (reward ? 0.019 : 0.0045));
    const tail = Math.min(1, (data.length - 1 - i) / (sampleRate * 0.004));
    data[i] = (low - bottom) * attack * decay * tail;
    peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= 0.75 / peak;
  return data;
}

// Measure each channel separately so opposite-phase stereo stays audible.
export function localMusicLevel(channels, sampleRate, time) {
  if (!channels.length || !sampleRate) return null;
  const start = Math.max(0, Math.floor((time - 0.025) * sampleRate));
  const span = Math.round(sampleRate * 0.06);
  let sum = 0, count = 0;
  for (const channel of channels) {
    const end = Math.min(channel.length, start + span);
    for (let index = start; index < end; index++) {
      sum += channel[index] ** 2; count++;
    }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

// Original short electronic sweeps: no speech sample or external asset required.
export function createComboCue(sampleRate, kind = 'light') {
  const major = kind === 'major', duration = major ? 0.48 : 0.30;
  const data = new Float32Array(Math.ceil(sampleRate * duration));
  let phase = 0, shimmer = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    const time = i / sampleRate, progress = time / duration;
    phase += 2 * Math.PI * (560 + 1450 * Math.exp(-time * 16)) / sampleRate;
    shimmer += 2 * Math.PI * (1120 + 1100 * progress) / sampleRate;
    const attack = Math.min(1, time / 0.008);
    const tail = Math.min(1, (data.length - 1 - i) / (sampleRate * 0.04));
    const envelope = attack * Math.exp(-time / (major ? 0.12 : 0.07)) * tail;
    const sparkle = major ? 0.3 * Math.sin(shimmer) * (0.5 + 0.5 * Math.cos(2 * Math.PI * time * 18)) : 0;
    data[i] = (Math.sin(phase + 0.5 * Math.sin(phase * 1.414)) + sparkle) * envelope;
    peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= 0.5 / peak;
  return data;
}
