export const MIRAGE_SONG = Object.freeze({ id: 'mirage-bloom', title: 'MIRAGE BLOOM', artist: 'PULSE LAB', bpm: 112, bars: 32, genre: 'WORLD / DREAM LOUNGE' });
export const MIRAGE_BEAT = 60 / MIRAGE_SONG.bpm;
export const MIRAGE_DURATION = MIRAGE_SONG.bars * 4 * MIRAGE_BEAT + 3.2;

// A newly authored modal composition. The same score feeds sound and gameplay.
export function createMirageScore() {
  const events = [];
  const roots = [50, 46, 48, 50];
  const harmony = [[0, 3, 7, 14], [0, 4, 7, 14], [0, 5, 7, 14], [0, 3, 7, 10]];
  const pluckPhrase = [0, 7, 14, 3, 12, 10, 7, 2];
  const leadPhrases = [
    [[0.5, 7, 1.15], [2.25, 10, 0.75], [3.5, 5, 1.2], [5, 7, 1.4], [7, 3, 0.8]],
    [[0.25, 2, 1.35], [2, 3, 0.85], [3.25, 7, 1.2], [5.5, 5, 0.65], [6.5, 2, 1.3]],
    [[0.75, 12, 1.5], [3, 10, 0.8], [4.5, 7, 1.25], [6.5, 5, 1.25]],
    [[0.5, 3, 1.1], [2.25, 2, 0.7], [3.5, 0, 2.2], [6.5, 7, 1.1]],
  ];
  const swing = beat => Math.abs(beat % 1 - 0.5) < 1e-8 ? beat + 0.045 : beat;
  const add = (voice, beat, pitch = 0, velocity = 1, extra = {}) => events.push({ voice, beat, time: beat * MIRAGE_BEAT, pitch, velocity, ...extra });
  for (let bar = 0; bar < MIRAGE_SONG.bars; bar++) {
    const base = bar * 4, sectionChord = Math.floor(bar / 4) % roots.length, root = roots[sectionChord];
    const intro = bar < 4, bridge = bar >= 12 && bar < 16, outro = bar >= 28;
    const energy = intro ? 0.62 : bridge ? 0.58 : outro ? 0.68 : 1;
    if (bar % 4 === 0) {
      for (const [index, interval] of harmony[sectionChord].entries()) add('pad', base, root + 12 + interval, 0.8, { duration: 16 * MIRAGE_BEAT + 0.7, pan: index % 2 ? 0.68 : -0.68 });
      add('drone', base, root - 12, 0.65, { duration: 16 * MIRAGE_BEAT + 0.6 });
    }
    add('air', base, 0, bridge ? 0.8 : 0.35, { duration: 4 * MIRAGE_BEAT, pan: bar % 2 ? 0.6 : -0.6 });
    for (const beat of intro || bridge ? [0] : outro ? [0, 2] : [0, 2, 2.75]) add('kick', base + beat, 0, energy * (beat === 2.75 ? 0.55 : 1));
    const hands = bridge ? [1.5, 3] : intro ? [1, 3] : [0.75, 1.5, 2.5, 3.25, 3.75];
    hands.forEach((beat, step) => add(step % 3 === 0 ? 'dum' : 'tak', swing(base + beat), step % 3 === 0 ? 46 : 58 + step % 2 * 2, energy * (step % 2 ? 0.62 : 0.88), { pan: step % 2 ? 0.22 : -0.2 }));
    if (!bridge) for (let step = 0; step < (intro || outro ? 4 : 8); step++) add('shaker', swing(base + step * (intro || outro ? 1 : 0.5)), 0, (step % 2 ? 0.6 : 0.3) * energy, { pan: step % 2 ? 0.4 : -0.4 });
    if (!intro && !bridge) for (const [step, beat] of [0, 1.75, 2.5, 3.5].entries()) {
      if (outro && step % 2) continue;
      add('bass', swing(base + beat), root - 12 + (step === 3 && bar % 2 ? 7 : 0), energy, { duration: MIRAGE_BEAT * 0.8 });
    }
    const plucks = bridge ? [0.75, 2.5] : intro ? [0.5, 2.5] : outro ? [0.5, 2, 3.5] : [0.5, 1.25, 2, 2.75, 3.5];
    plucks.forEach((beat, step) => {
      let interval = pluckPhrase[(step + bar % 4 * 2) % pluckPhrase.length];
      if (sectionChord === 1 && interval === 3) interval = 4;
      if (sectionChord === 2 && interval === 3) interval = 5;
      add('pluck', swing(base + beat), root + 12 + interval, energy * (step % 2 ? 0.7 : 0.95), { duration: MIRAGE_BEAT * (bridge ? 1.8 : 1.1), pan: step % 2 ? 0.48 : -0.48 });
    });
    // Four original call-and-response phrases leave space for the percussion.
    if (bar % 2 === 0 && (bar >= 4 && bar < 12 || bar >= 16 && bar < 28)) {
      const phrase = leadPhrases[Math.floor(bar / 2) % leadPhrases.length];
      for (const [step, [beat, interval, beatsLong]] of phrase.entries()) add('flute', base + beat, 62 + interval, 0.78 + (bar >= 20 ? 0.08 : 0), { duration: beatsLong * MIRAGE_BEAT, pan: step % 2 ? 0.1 : -0.1 });
    }
    if (bridge && bar % 2 === 0) add('flute', base + 1, 69 - (bar === 14 ? 2 : 0), 0.62, { duration: 2.6 * MIRAGE_BEAT, pan: bar === 12 ? -0.25 : 0.25 });
    if ([3, 15, 27].includes(bar)) add('swell', base + 2, 0, bar === 15 ? 0.65 : 0.35, { duration: 2 * MIRAGE_BEAT });
  }
  return events.sort((a, b) => a.time - b.time);
}

export function createMirageChart(difficulty = 'normal') {
  const priorities = { kick: 0, dum: 1, tak: 2, flute: 3, pluck: 4, bass: 5, shaker: 6 };
  const voices = difficulty === 'easy' ? ['kick', 'dum', 'flute'] : difficulty === 'hard' ? Object.keys(priorities) : ['kick', 'dum', 'tak', 'flute', 'pluck'];
  const candidates = createMirageScore().filter(event => voices.includes(event.voice) && event.beat >= 8 && event.beat < 124).sort((a, b) => a.time - b.time || priorities[a.voice] - priorities[b.voice]);
  const notes = [], lastLane = Array(4).fill(-Infinity);
  const gap = MIRAGE_BEAT * (difficulty === 'easy' ? 1.25 : difficulty === 'normal' ? 0.45 : 0.2);
  let previous = -Infinity, simultaneous = 0;
  for (const [index, event] of candidates.entries()) {
    const chord = Math.abs(event.time - previous) < 1e-8;
    const accent = Math.floor(event.beat / 4) % 4 === 3;
    const allowChord = difficulty === 'hard' || difficulty === 'normal' && accent && event.voice === 'flute';
    if (chord ? !allowChord || simultaneous >= 2 : event.time - previous < gap) continue;
    const startLane = event.voice === 'kick' ? Math.floor(event.beat / 4) % 2 * 3 : event.voice === 'dum' || event.voice === 'tak' ? 1 + Math.floor(event.beat / 8) % 2 : (index + Math.floor(event.beat / 16)) % 4;
    const lane = Array.from({ length: 4 }, (_, offset) => (startLane + offset) % 4).find(candidate => event.time - lastLane[candidate] >= 0.2);
    if (lane === undefined) continue;
    notes.push({ time: event.time, lane, id: notes.length, judged: false });
    lastLane[lane] = event.time; previous = event.time;
    simultaneous = chord ? simultaneous + 1 : 1;
  }
  return notes;
}
