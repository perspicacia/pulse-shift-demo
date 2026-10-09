// Pure DSP shared by the worker and deterministic audio fixtures. All times are
// measured in seconds from the decoded file; no wall-clock or frame-count clock.
export const FILE_LIMIT = 40 * 1024 * 1024;
export const MAX_DURATION = 300;

export function validateFile(file) {
  if (!file || file.size === 0) throw new Error('비어 있는 파일이에요. 다른 음악을 선택해주세요.');
  if (file.size > FILE_LIMIT) throw new Error('40MB 이하의 음악 파일을 선택해주세요.');
}

export function validateAudio(duration, channels) {
  if (!Number.isFinite(duration) || duration < 12 || duration > MAX_DURATION) throw new Error('12초 이상, 5분 이하의 음악을 선택해주세요.');
  if (channels < 1 || channels > 2) throw new Error('모노 또는 스테레오 음악을 선택해주세요.');
}

export function extractFeatures(channels, sampleRate) {
  if (!channels.length || !sampleRate) throw new Error('음악 데이터를 읽지 못했어요.');
  const frameSize = Math.max(1, Math.round(sampleRate / 200));
  const hop = frameSize / sampleRate, count = Math.ceil(channels[0].length / frameSize);
  const energy = new Float32Array(count), flux = new Float32Array(count);
  const stride = Math.max(1, Math.floor(sampleRate / 12000));
  const alpha = 1 - Math.exp(-2 * Math.PI * 160 * stride / sampleRate);
  const low = channels.map(() => 0), previous = channels.map(() => 0);
  let lastEnergy = 0, lastBass = 0, lastTreble = 0;
  for (let frame = 0; frame < count; frame++) {
    let e = 0, b = 0, h = 0, samples = 0;
    const end = Math.min(channels[0].length, (frame + 1) * frameSize);
    for (let i = frame * frameSize; i < end; i += stride) for (let channel = 0; channel < channels.length; channel++) {
      const value = channels[channel][i];
      low[channel] += alpha * (value - low[channel]);
      e += value ** 2; b += low[channel] ** 2; h += (value - previous[channel]) ** 2;
      previous[channel] = value; samples++;
    }
    const bass = Math.sqrt(b / Math.max(1, samples)), treble = Math.sqrt(h / Math.max(1, samples));
    energy[frame] = Math.sqrt(e / Math.max(1, samples));
    flux[frame] = Math.max(0, energy[frame] - lastEnergy) + Math.max(0, bass - lastBass) + .35 * Math.max(0, treble - lastTreble);
    lastEnergy = energy[frame]; lastBass = bass; lastTreble = treble;
  }
  return { energy, flux, hop, duration: channels[0].length / sampleRate };
}

function correlation(flux, lag) {
  let dot = 0, a = 0, b = 0;
  for (let i = lag; i < flux.length; i++) { dot += flux[i] * flux[i - lag]; a += flux[i] ** 2; b += flux[i - lag] ** 2; }
  return dot / Math.max(1e-12, Math.sqrt(a * b));
}

export function analyzeFeatures({ energy, flux, hop, duration }) {
  const peak = energy.reduce((a, b) => Math.max(a, b), 0);
  const maxFlux = flux.reduce((a, b) => Math.max(a, b), 0);
  if (peak < .0001 || maxFlux < .00001) throw new Error('뚜렷한 박자를 찾지 못했어요. 드럼이나 비트가 있는 곡을 선택해주세요.');
  const prefix = new Float64Array(flux.length + 1);
  for (let i = 0; i < flux.length; i++) prefix[i + 1] = prefix[i] + flux[i];
  const radius = Math.round(.16 / hop), onsets = [];
  for (let i = 0; i < flux.length - 1; i++) {
    const from = Math.max(0, i - radius), to = Math.min(flux.length, i + radius + 1);
    const mean = (prefix[to] - prefix[from]) / (to - from);
    if (flux[i] < Math.max(maxFlux * .025, mean * 1.5) || energy[i] < peak * .015 || i > 0 && flux[i] < flux[i - 1] || flux[i] <= flux[i + 1]) continue;
    const point = { time: i * hop, strength: flux[i] / maxFlux };
    if (onsets.length && point.time - onsets.at(-1).time < .09) {
      if (point.strength > onsets.at(-1).strength) onsets[onsets.length - 1] = point;
    } else onsets.push(point);
  }
  if (onsets.length < 8) throw new Error('박자 분석에 필요한 소리가 부족해요. 비트가 더 뚜렷한 곡을 선택해주세요.');
  // Autocorrelation detects a repeating pulse. Half/double tempo can be
  // musically ambiguous, so the UI exposes both rather than hiding the estimate.
  let bpm = 120, best = -1;
  const usedLags = new Set();
  for (let candidate = 60; candidate <= 240; candidate += .25) {
    const lag = Math.round(60 / candidate / hop);
    if (usedLags.has(lag)) continue;
    usedLags.add(lag);
    const pulse = .7 * correlation(flux, lag) + .2 * correlation(flux, lag * 2) + .1 * correlation(flux, lag * 3);
    const period = lag * hop;
    let intervals = 0, weights = 0;
    for (let i = 0; i < onsets.length - 1; i++) for (let j = i + 1; j < Math.min(onsets.length, i + 5); j++) {
      const distance = (onsets[j].time - onsets[i].time) / period, beats = Math.round(distance);
      const weight = Math.sqrt(onsets[i].strength * onsets[j].strength);
      weights += weight;
      if (beats >= 1 && beats <= 8) intervals += weight * Math.exp(-Math.pow((distance - beats) / .08, 2)) / Math.sqrt(beats);
    }
    const score = (.45 * pulse + .55 * intervals / Math.max(1e-9, weights)) * (1 - .025 * Math.abs(Math.log2(candidate / 120)));
    if (score > best) { best = score; bpm = 60 / (lag * hop); }
  }
  let period = 60 / bpm, anchor = onsets[0].time, phaseScore = -1;
  let intervalSum = 0, intervalWeight = 0;
  for (let i = 0; i < onsets.length - 1; i++) for (let j = i + 1; j < Math.min(onsets.length, i + 5); j++) {
    const interval = onsets[j].time - onsets[i].time, beats = Math.round(interval / period);
    if (beats < 1 || beats > 8 || Math.abs(interval - beats * period) > period * .08) continue;
    const weight = Math.sqrt(onsets[i].strength * onsets[j].strength);
    intervalSum += interval / beats * weight; intervalWeight += weight;
  }
  if (intervalWeight > 0) { period = intervalSum / intervalWeight; bpm = 60 / period; }
  const phaseCandidates = [...onsets.slice(0, 16), ...[...onsets].sort((a, b) => b.strength - a.strength).slice(0, 24)];
  for (const candidate of phaseCandidates) {
    let score = 0;
    for (const point of onsets) {
      const distance = Math.abs((point.time - candidate.time) / period - Math.round((point.time - candidate.time) / period));
      score += point.strength * Math.exp(-((distance / .08) ** 2));
    }
    if (score > phaseScore) { phaseScore = score; anchor = candidate.time; }
  }
  // Fit actual attacks to beat indices for sub-frame tempo precision. This
  // matters at the end of a five-minute song, not only in its opening bars.
  const aligned = onsets.map(point => ({ ...point, beat: Math.round((point.time - anchor) / period) }))
    .filter(point => Math.abs(point.time - anchor - point.beat * period) < period * .1);
  let firstBeat = onsets[0].time;
  if (aligned.length >= 8) {
    let sum = 0, x = 0, y = 0, xx = 0, xy = 0;
    for (const point of aligned) { const w = Math.max(.1, point.strength); sum += w; x += w * point.beat; y += w * point.time; xx += w * point.beat ** 2; xy += w * point.beat * point.time; }
    const fitted = (sum * xy - x * y) / (sum * xx - x * x);
    if (Number.isFinite(fitted) && Math.abs(fitted / period - 1) < .02) { period = fitted; anchor = (y - period * x) / sum; bpm = 60 / period; }
    firstBeat = anchor + Math.round((onsets[0].time - anchor) / period) * period;
    if (firstBeat < 0 && firstBeat >= -hop * 2) firstBeat = 0;
    while (firstBeat < 0) firstBeat += period;
  }
  const inGrid = onsets.filter(point => Math.abs((point.time - firstBeat) / (period / 2) - Math.round((point.time - firstBeat) / (period / 2))) < .15).length;
  let unstable = inGrid / onsets.length < .65;
  for (let start = firstBeat; start < duration; start += 12) {
    const points = onsets.filter(point => point.time >= start && point.time < start + 12);
    if (points.length >= 12 && points.filter(point => Math.abs((point.time - firstBeat) / (period / 2) - Math.round((point.time - firstBeat) / (period / 2))) < .15).length / points.length < .55) unstable = true;
  }
  const confidence = Math.min(1, Math.max(0, best) * .45 + inGrid / onsets.length * .55);
  const waveform = Array.from({ length: 160 }, (_, i) => {
    const from = Math.floor(i * energy.length / 160), to = Math.max(from + 1, Math.floor((i + 1) * energy.length / 160));
    let max = 0; for (let j = from; j < to; j++) max = Math.max(max, energy[j]); return max / peak;
  });
  return { bpm: Math.max(60, Math.min(240, Math.round(bpm * 100) / 100)), firstBeat: Math.max(0, Math.round(firstBeat * 1000) / 1000), confidence, unstable, onsets, waveform, duration };
}

export function validateCalibration({ bpm, firstBeat }, duration) {
  if (!Number.isFinite(bpm) || bpm < 60 || bpm > 240) throw new Error('BPM은 60~240 사이로 입력해주세요.');
  if (!Number.isFinite(firstBeat) || firstBeat < 0 || firstBeat > duration - 2) throw new Error(`첫 박 위치는 0~${Math.max(0, duration - 2).toFixed(2)}초 사이로 입력해주세요.`);
  return { bpm: Math.round(bpm * 100) / 100, firstBeat: Math.round(firstBeat * 1000) / 1000 };
}

export function createPersonalChart(analysis, config, keyCount = 4, difficulty = 'normal') {
  config = validateCalibration(config, analysis.duration);
  if (![4, 6].includes(keyCount) || !['easy', 'normal', 'hard'].includes(difficulty)) throw new RangeError('지원하지 않는 채보 설정이에요.');
  const beat = 60 / config.bpm, step = difficulty === 'hard' ? beat / 2 : beat;
  const gap = beat * (difficulty === 'easy' ? 1.8 : difficulty === 'normal' ? .8 : .4);
  const pattern = keyCount === 6 ? [0, 3, 1, 4, 2, 5, 1, 4, 0, 3, 2, 5] : [0, 2, 1, 3, 1, 2, 0, 3];
  const grid = new Map();
  for (const point of analysis.onsets) {
    const index = Math.round((point.time - config.firstBeat) / step), time = config.firstBeat + index * step;
    if (index < 0 || time < 0 || time > analysis.duration - .25 || Math.abs(time - point.time) > Math.min(.12, beat * .25)) continue;
    grid.set(index, Math.max(grid.get(index) || 0, point.strength));
  }
  const notes = [], lastLane = Array(keyCount).fill(-Infinity);
  let lastTime = -Infinity, group = 0;
  for (const [index, strength] of [...grid].sort((a, b) => a[0] - b[0])) {
    const time = config.firstBeat + index * step;
    if (time - lastTime < gap - 1e-6) continue;
    const lane = pattern[group % pattern.length];
    if (time - lastLane[lane] < .18) continue;
    notes.push({ time, lane }); lastLane[lane] = time;
    if (difficulty === 'hard' && group % 4 === 3 && strength >= .6) {
      const other = (lane + keyCount / 2) % keyCount;
      if (time - lastLane[other] >= .18) { notes.push({ time, lane: other }); lastLane[other] = time; }
    }
    lastTime = time; group++;
  }
  if (notes.length < 4) throw new Error('이 설정으로는 노트가 너무 적어요. 첫 박 위치·BPM을 확인해주세요.');
  return notes;
}

export function personalRevision(config) { return `grid-v1:${config.bpm.toFixed(2)}:${config.firstBeat.toFixed(3)}`; }

export function personalTestRange(track, position = 'start') {
  const beginning = Math.max(0, track.beatOffset - .75);
  const from = Math.max(beginning, position === 'end' ? track.duration - 10 : position === 'middle' ? track.duration / 2 - 5 : beginning);
  return { from, to: Math.min(track.duration, from + 10), position };
}

export function makePersonalTrack({ id, title, buffer, analysis, config }) {
  config = validateCalibration(config, buffer.duration);
  const charts = Object.fromEntries([4, 6].map(keys => [keys, Object.fromEntries(['easy', 'normal', 'hard'].map(mode => [mode, createPersonalChart(analysis, config, keys, mode)]))]));
  return { id, title, buffer, analysis, config, charts, personal: true, revision: personalRevision(config), buttonId: 'personal-track', number: '004', artist: 'MY MUSIC', genre: 'PERSONAL / AUTO CHART', cover: './assets/personal-disc.svg', bpm: config.bpm, beatOffset: config.firstBeat, previewBeat: 8, duration: buffer.duration, description: '내 음악으로 만드는 새로운 리듬.\n자동 채보는 추정값이에요. 10초 테스트로 박자를 확인해보세요.' };
}
