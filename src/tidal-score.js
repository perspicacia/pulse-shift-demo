export const TIDAL_SONG = Object.freeze({ id: 'tidal-circuit', title: 'TIDAL CIRCUIT', artist: 'PULSE LAB', bpm: 132, bars: 40, genre: 'MODULAR / BROKEN BEAT' });
export const TIDAL_BEAT = 60 / TIDAL_SONG.bpm;
export const TIDAL_DURATION = TIDAL_SONG.bars * 4 * TIDAL_BEAT + 3;

// One authored score drives both the rendered instruments and the playable notes.
export function createTidalScore() {
  const events = [], roots = [48, 46, 44, 41];
  const chords = [[0, 3, 7, 10, 14], [0, 4, 7, 11, 14], [0, 4, 7, 11, 14], [0, 3, 7, 10, 17]];
  const motif = [7, 14, 10, 3, 12, 7, 17, 10];
  const swing = beat => Math.abs(beat % 1 - 0.5) < 0.001 ? beat + 0.065 : beat;
  const add = (voice, beat, pitch = 0, velocity = 1, extra = {}) => events.push({ voice, beat, time: beat * TIDAL_BEAT, pitch, velocity, ...extra });
  for (let bar = 0; bar < TIDAL_SONG.bars; bar++) {
    const base = bar * 4, chord = Math.floor(bar / 4) % 4, root = roots[chord];
    const intro = bar < 4, breakdown = bar >= 16 && bar < 20, outro = bar >= 36;
    const energy = intro ? 0.65 : outro ? 0.7 : 1;
    if (bar % 4 === 0) for (const [i, interval] of chords[chord].entries()) add('pad', base, root + 12 + interval, 0.8, { duration: 16 * TIDAL_BEAT + 0.5, pan: i % 2 ? 0.72 : -0.72 });
    add('air', base, 0, breakdown ? 0.8 : 0.35, { duration: 4 * TIDAL_BEAT });
    for (const kick of breakdown ? [0] : intro || outro ? [0, 2.75] : bar % 2 ? [0, 1.75, 2.5] : [0, 1.5, 2.75]) add('kick', swing(base + kick), 0, energy);
    if (!intro && !breakdown) for (const beat of [1, 3]) add('snare', base + beat, 0, energy);
    if (!intro && !breakdown && !outro && bar % 4 === 3) add('rim', base + 3.75, 0, 0.45);
    for (let step = 0; step < 8; step++) {
      if (breakdown && step % 2 || outro && step % 2) continue;
      add('hat', swing(base + step / 2), 0, (step % 2 ? 0.6 : 0.35) * energy, { open: !intro && !breakdown && step === 7, pan: step % 2 ? 0.25 : -0.25 });
    }
    if (!breakdown) for (const [i, beat] of [0.5, 1.75, 2.5, 3.5].entries()) {
      if (intro && i % 2) continue;
      add('bass', swing(base + beat), root - 12 + (i === 3 && bar % 2 ? 7 : 0), energy, { duration: TIDAL_BEAT * 0.62 });
    }
    const plucks = breakdown ? [0, 2.5] : intro ? [0.75, 2.5] : outro ? [0.75, 2.25, 3.5] : bar % 2 ? [0.5, 1.25, 2, 3.5] : [0.75, 1.5, 2.25, 3.5];
    plucks.forEach((beat, step) => {
      let interval = motif[(step + Math.floor(bar / 2) * 3) % motif.length];
      if (chord === 1 || chord === 2) interval = interval === 3 ? 4 : interval === 10 ? 11 : interval;
      add('pluck', swing(base + beat), root + 12 + interval, energy * (breakdown ? 0.85 : 1), { pan: step % 2 ? 0.3 : -0.3, duration: TIDAL_BEAT * (breakdown ? 2 : 1.1) });
    });
    if (bar === 19 || bar === 35) add('swell', base, 0, bar === 19 ? 1 : 0.4, { duration: 4 * TIDAL_BEAT });
  }
  return events.sort((a, b) => a.time - b.time);
}

export function createTidalChart(difficulty = 'normal') {
  const priorities = { kick: 0, snare: 1, pluck: 2, rim: 3, hat: 4 };
  const voices = difficulty === 'easy' ? ['kick', 'snare'] : difficulty === 'hard' ? Object.keys(priorities) : ['kick', 'snare', 'pluck'];
  const candidates = createTidalScore().filter(event => voices.includes(event.voice) && event.beat >= 8 && event.beat < 156).sort((a, b) => a.time - b.time || priorities[a.voice] - priorities[b.voice]);
  const notes = [], lastLane = [-Infinity, -Infinity, -Infinity, -Infinity];
  let previous = -Infinity, atTime = 0;
  for (const [index, event] of candidates.entries()) {
    const chord = Math.abs(event.time - previous) < 0.00001;
    const minGap = difficulty === 'easy' ? TIDAL_BEAT * 1.15 : difficulty === 'normal' ? TIDAL_BEAT * 0.45 : TIDAL_BEAT * 0.2;
    const accentBar = Math.floor(event.beat / 4) % 4 === 3;
    const allowChord = difficulty === 'hard' && (event.voice !== 'hat' || accentBar) || difficulty === 'normal' && accentBar;
    if (chord ? !allowChord || atTime >= 2 : event.time - previous < minGap) continue;
    const laneBase = event.voice === 'kick' ? Math.floor(event.beat / 4) % 2 * 3 : event.voice === 'snare' ? 1 + Math.floor(event.beat / 8) % 2 : (index + Math.floor(event.beat / 16)) % 4;
    const lane = Array.from({ length: 4 }, (_, i) => (laneBase + i) % 4).find(lane => event.time - lastLane[lane] >= 0.2);
    if (lane === undefined) continue;
    notes.push({ time: event.time, lane, id: notes.length, judged: false });
    atTime = chord ? atTime + 1 : 1;
    previous = event.time; lastLane[lane] = event.time;
  }
  return notes;
}
