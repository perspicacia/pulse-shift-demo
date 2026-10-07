import { KEYS, createChart } from './game.js';

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

export function chartFor(track, keyCount, difficulty) {
  if (keyCount === 4) return track.charts[difficulty];
  if (keyCount !== 6 || track.id !== 'afterglow' || difficulty !== 'easy') {
    throw new RangeError('6키 실험은 AFTERGLOW LEVEL 1에서만 지원합니다.');
  }
  return createSixKeyChart();
}

export function modeRecordKey(trackId, difficulty, keyCount) {
  return `${trackId}:${keyCount}k:${difficulty}`;
}
