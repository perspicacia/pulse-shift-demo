export const SUNSET_SONG = Object.freeze({ id: 'sunset-sip', title: 'SUNSET SIP', artist: 'PULSE LAB', bpm: 106, bars: 32, genre: 'NU JAZZ / SUNSET LOUNGE' });
export const SUNSET_BEAT = 60 / SUNSET_SONG.bpm;
export const SUNSET_DURATION = SUNSET_SONG.bars * 4 * SUNSET_BEAT + 3;

// An original lounge score: extended piano voicings, a walking bass, and swung percussion.
// The exact same event times drive the synthesizer and all playable charts.
export function createSunsetScore() {
  const events = [], roots = [53, 50, 55, 48];
  const voicings = [[7, 11, 14, 16], [7, 10, 14, 15], [7, 10, 14, 15], [5, 10, 14, 21]];
  const melodies = [
    [[0.5, 69], [1.5, 67], [2.75, 64]],
    [[0.75, 65], [2, 64], [3.5, 62]],
    [[0.5, 67], [1.75, 69], [3, 70]],
    [[0.75, 69], [2.5, 67], [3.5, 65]],
    [[0.5, 72], [1.5, 69], [3, 67]],
    [[0.75, 64], [2, 65], [3.5, 69]],
    [[0.5, 70], [2, 69], [3.25, 67]],
    [[0.75, 65], [2.5, 64], [3.5, 62]],
  ];
  const swing = beat => Math.abs(beat % 1 - 0.5) < 1e-8 ? beat + 0.08 : beat;
  const add = (voice, beat, pitch = 0, velocity = 1, extra = {}) => events.push({ voice, beat, time: beat * SUNSET_BEAT, pitch, velocity, ...extra });
  for (let bar = 0; bar < SUNSET_SONG.bars; bar++) {
    const base = bar * 4, harmony = Math.floor(bar / 2) % 4, root = roots[harmony];
    const intro = bar < 4, breakdown = bar >= 14 && bar < 18, outro = bar >= 30;
    const energy = breakdown ? 0.56 : intro ? 0.65 : outro ? 0.55 : 0.92;
    const section = intro ? 'intro' : breakdown ? 'break' : outro ? 'outro' : bar < 14 ? 'groove' : 'return';
    if (bar % 2 === 0) for (const [index, interval] of [7, 14].entries()) {
      add('pad', base, root + interval, 0.65, { duration: 8 * SUNSET_BEAT + 0.7, pan: index ? 0.75 : -0.75, section });
    }
    add('sea', base, 0, breakdown ? 0.8 : 0.38, { duration: 4 * SUNSET_BEAT, pan: bar % 2 ? 0.45 : -0.45, section });
    for (const beat of breakdown ? [0] : intro || outro ? [0, 2.5] : bar % 2 ? [0, 1.75, 2.5] : [0, 2, 3.5]) {
      add('kick', swing(base + beat), 0, energy * (beat === 0 ? 1 : 0.76), { section });
    }
    if (!intro && !breakdown && !outro) for (const beat of [1, 3]) add('snare', base + beat, 0, energy * (beat === 1 ? 0.82 : 1), { section });
    for (let step = 0; step < 8; step++) {
      if ((intro || breakdown || outro) && step % 2) continue;
      add('shaker', swing(base + step / 2), 0, energy * (step % 2 ? 0.58 : 0.31), { pan: step % 2 ? 0.28 : -0.28, section });
    }
    if (!intro && !breakdown && !outro && bar % 4 === 3) for (const beat of [2.75, 3.75]) add('rim', base + beat, 0, 0.42, { pan: -0.2, section });
    const basses = breakdown ? [[0, 0]] : intro || outro ? [[0, 0], [2.5, 7]] : [[0, 0], [1.5, 7], [2.5, 12], [3.5, bar % 2 ? -2 : 7]];
    for (const [beat, interval] of basses) add('bass', swing(base + beat), root - 12 + interval, energy, { duration: SUNSET_BEAT * (breakdown ? 1.8 : beat === 0 ? 0.95 : 0.68), section });
    const chordBeats = intro || breakdown || outro ? [0.5] : bar % 2 ? [0.5, 2.75] : [0.5, 2.5];
    for (const [hit, beat] of chordBeats.entries()) for (const [index, interval] of voicings[harmony].entries()) {
      add('keys', swing(base + beat), root + interval, energy * (hit ? 0.7 : 0.9), { duration: SUNSET_BEAT * (breakdown ? 3.4 : hit ? 1.35 : 2.1), pan: [-0.4, 0.3, -0.15, 0.48][index], chartable: index === 0, section });
    }
    if (bar >= 6 && !outro) {
      const phrase = melodies[(bar + (bar >= 18 ? 2 : 0)) % melodies.length];
      const selected = breakdown ? phrase.filter((_, index) => index === 0) : bar % 2 ? phrase.slice(0, 2) : phrase;
      for (const [index, [beat, pitch]] of selected.entries()) add('lead', swing(base + beat), pitch, breakdown ? 0.52 : 0.72, { duration: SUNSET_BEAT * (breakdown ? 2.6 : index === selected.length - 1 ? 1.25 : 0.9), pan: bar % 2 ? -0.16 : 0.16, section });
    }
    if (bar === 13 || bar === 17 || bar === 29) add('brush', base + 2, 0, bar === 17 ? 0.8 : 0.5, { duration: 2 * SUNSET_BEAT, section });
  }
  return events.sort((a, b) => a.time - b.time);
}

export function createSunsetChart(difficulty = 'normal') {
  const priorities = { kick: 0, snare: 1, keys: 2, lead: 3, bass: 4, rim: 5, shaker: 6 };
  const voices = difficulty === 'easy' ? ['kick', 'snare'] : difficulty === 'hard' ? Object.keys(priorities) : ['kick', 'snare', 'keys', 'lead', 'bass'];
  const candidates = createSunsetScore().filter(event => voices.includes(event.voice) && event.chartable !== false && event.beat >= 8 && event.beat < 124).sort((a, b) => a.time - b.time || priorities[a.voice] - priorities[b.voice]);
  const notes = [], lastLane = Array(4).fill(-Infinity);
  const gap = SUNSET_BEAT * (difficulty === 'easy' ? 1.1 : difficulty === 'hard' ? 0.18 : 0.4);
  let previous = -Infinity, simultaneous = 0;
  for (const [index, event] of candidates.entries()) {
    const chord = Math.abs(event.time - previous) < 1e-8;
    const accent = Math.floor(event.beat / 4) % 4 === 3;
    const allowChord = difficulty === 'hard' && event.voice !== 'shaker' || difficulty === 'normal' && accent && event.voice === 'bass';
    if (chord ? !allowChord || simultaneous >= 2 : event.time - previous < gap) continue;
    const startLane = event.voice === 'kick' ? Math.floor(event.beat / 4) % 2 * 3 : event.voice === 'snare' ? 1 + Math.floor(event.beat / 8) % 2 : (index + Math.floor(event.beat / 8)) % 4;
    const lane = Array.from({ length: 4 }, (_, offset) => (startLane + offset) % 4).find(lane => event.time - lastLane[lane] >= 0.2 - 1e-9);
    if (lane === undefined) continue;
    notes.push({ time: event.time, lane, id: notes.length, judged: false });
    lastLane[lane] = event.time;
    simultaneous = chord ? simultaneous + 1 : 1;
    previous = event.time;
  }
  return notes;
}
