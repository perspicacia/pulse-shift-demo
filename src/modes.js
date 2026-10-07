import { KEYS, createChart } from './game.js';
import { ASTRAL_BEAT, createAstralScore, createAstralChart } from './astral-score.js';

const keyModes = Object.freeze({
  4: Object.freeze([...KEYS]),
  6: Object.freeze(['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL']),
});

export function keysFor(keyCount = 4) {
  const keys = keyModes[keyCount];
  if (!keys) throw new RangeError('지원하지 않는 키 개수입니다.');
  return keys;
}

// Preserve AFTERGLOW's authored beat times; only the experimental lane pattern changes.
export function createSixKeyChart() {
  const pattern = [0, 1, 2, 3, 4, 5, 2, 1, 4, 3, 0, 5];
  const notes = [];
  createChart('easy').forEach((note, index) => {
    const lane = pattern[index % pattern.length];
    notes.push({ time: note.time, lane });
    // Occasional two-hand chords, never more than two simultaneous notes.
    if (index % 8 === 7) notes.push({ time: note.time, lane: (lane + 3) % 6 });
  });
  return notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
}

export function sixKeyDifficulty(trackId) {
  return trackId === 'afterglow' ? 'easy' : trackId === 'astral-veil' ? 'hard' : null;
}

export function sixKeyDifficulties(trackId) {
  return trackId === 'afterglow' ? ['easy'] : trackId === 'astral-veil' ? ['normal', 'hard'] : [];
}

// LEVEL 2 keeps the four-key chart's authored timing, density and two-note cap.
// Alternate hands across six lanes; two-note accents use one key in each hand.
export function createAstralSixKeyNormalChart() {
  const pattern = [0, 3, 1, 4, 2, 5, 1, 4, 0, 3, 2, 5];
  const notes = [];
  let previous = -Infinity, group = 0;
  for (const note of createAstralChart('normal')) {
    const chord = Math.abs(note.time - previous) < 1e-8;
    const lane = chord ? (notes.at(-1).lane + 3) % 6 : pattern[group++ % pattern.length];
    notes.push({ time: note.time, lane });
    previous = note.time;
  }
  return notes;
}

// Six-key LEVEL 3 follows the actual drum, bass, lead and arpeggio onsets.
// Spread dense phrases across both hands; cap chords at three distinct keys.
export function createAstralSixKeyChart() {
  const priorities = { kick: 0, snare: 1, bass: 2, lead: 3, arp: 4, hat: 5 };
  const candidates = createAstralScore().filter(event => Object.hasOwn(priorities, event.voice) && event.beat >= 8 && event.beat < 140)
    .sort((a, b) => a.time - b.time || priorities[a.voice] - priorities[b.voice]);
  const notes = [], lastLane = Array(6).fill(-Infinity);
  let previous = -Infinity, simultaneous = 0;
  for (const [index, event] of candidates.entries()) {
    const chord = Math.abs(event.time - previous) < 1e-8;
    if (chord ? simultaneous >= 3 : event.time - previous < ASTRAL_BEAT * 0.23) continue;
    const bar = Math.floor(event.beat / 4);
    const startLane = event.voice === 'kick' ? (bar % 2 ? 5 : 0)
      : event.voice === 'snare' ? (bar % 2 ? 4 : 1)
      : (index + Math.floor(event.beat / 16)) % 6;
    const lane = Array.from({ length: 6 }, (_, i) => (startLane + i) % 6)
      .find(value => event.time - lastLane[value] >= 0.18);
    if (lane === undefined) continue;
    notes.push({ time: event.time, lane });
    lastLane[lane] = event.time;
    previous = event.time;
    simultaneous = chord ? simultaneous + 1 : 1;
  }
  return notes;
}

export function chartFor(track, keyCount, difficulty) {
  if (keyCount === 4) return track.charts[difficulty];
  if (keyCount !== 6 || !sixKeyDifficulties(track.id).includes(difficulty)) {
    throw new RangeError('6키 실험은 AFTERGLOW LEVEL 1과 ASTRAL VEIL LEVEL 2·3에서 지원합니다.');
  }
  return track.id === 'astral-veil'
    ? difficulty === 'normal' ? createAstralSixKeyNormalChart() : createAstralSixKeyChart()
    : createSixKeyChart();
}

export function modeRecordKey(trackId, difficulty, keyCount) {
  return `${trackId}:${keyCount}k:${difficulty}`;
}
