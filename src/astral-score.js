export const ASTRAL_SONG = Object.freeze({ id: 'astral-veil', title: 'ASTRAL VEIL', artist: 'PULSE LAB', bpm: 126, bars: 36, genre: 'COSMIC / DARK ELECTRO' });
export const ASTRAL_BEAT = 60 / ASTRAL_SONG.bpm;
export const ASTRAL_DURATION = ASTRAL_SONG.bars * 4 * ASTRAL_BEAT + 3;

// The instruments and all three charts share this original composition.
export function createAstralScore() {
  const events = [], roots = [48, 44, 51, 46];
  const chords = [[0, 3, 7, 14], [0, 4, 7, 11], [0, 4, 7, 14], [0, 5, 7, 10]];
  const phrase = [7, 14, 12, 3, 7, 10, 14, 19];
  const add = (voice, beat, pitch = 0, velocity = 1, extra = {}) => events.push({ voice, beat, time: beat * ASTRAL_BEAT, pitch, velocity, ...extra });
  for (let bar = 0; bar < ASTRAL_SONG.bars; bar++) {
    const base = bar * 4, harmony = Math.floor(bar / 4) % 4, root = roots[harmony];
    const intro = bar < 4, interlude = bar >= 16 && bar < 20, outro = bar >= 32;
    const energy = intro ? 0.62 : outro ? 0.68 : 1;
    if (bar % 4 === 0) {
      for (const [i, interval] of chords[harmony].entries()) {
        add('pad', base, root + 12 + interval, interlude ? 1 : 0.8, { duration: 16 * ASTRAL_BEAT + 0.7, pan: [-0.78, 0.64, -0.42, 0.8][i] });
        if (bar >= 12) add('choir', base + 0.5, root + 12 + interval, interlude ? 1 : 0.52, { duration: 15 * ASTRAL_BEAT, pan: [-0.5, 0.5, -0.7, 0.7][i] });
      }
    }
    add('air', base, 0, interlude ? 0.8 : 0.25, { duration: 4 * ASTRAL_BEAT, pan: bar % 2 ? 0.65 : -0.65 });
    for (const beat of interlude ? [0] : [0, 1, 2, 3]) add('kick', base + beat, 0, energy * (beat === 0 ? 1 : 0.88));
    if (!intro && !interlude) for (const beat of [1, 3]) add('snare', base + beat, 0, energy);
    if (!interlude) for (let step = 0; step < (intro || outro ? 4 : 8); step++) {
      const beat = step * (intro || outro ? 1 : 0.5);
      add('hat', base + beat, 0, (step % 2 ? 0.8 : 0.35) * energy, { open: !intro && !outro && step === 7, pan: step % 2 ? 0.3 : -0.3 });
    }
    if (!interlude) for (const [step, beat] of [0.5, 1.5, 2.5, 3.25, 3.5].entries()) {
      if ((intro || outro) && step >= 3) continue;
      add('bass', base + beat, root - 12 + (step === 3 ? 7 : 0), energy, { duration: ASTRAL_BEAT * (step === 3 ? 0.23 : 0.43) });
    }
    const steps = interlude ? [0.5, 2.5] : intro || outro ? [0.5, 1.5, 2.5, 3.5] : [0.25, 0.5, 1.25, 1.5, 2.25, 2.5, 3.25, 3.5];
    steps.forEach((beat, step) => {
      add('arp', base + beat, root + 12 + chords[harmony][(step + bar) % 4], energy * (step % 2 ? 0.9 : 0.68), { duration: ASTRAL_BEAT * (interlude ? 2.2 : 0.72), pan: step % 2 ? 0.55 : -0.55 });
    });
    if ((bar >= 12 && bar < 16 || bar >= 20 && bar < 32) && bar % 2 === 0) {
      for (const [step, beat] of [0.75, 2, 3.5].entries()) {
        let interval = phrase[(Math.floor(bar / 2) + step * 2) % phrase.length];
        if (harmony === 1 || harmony === 2) interval = interval === 3 ? 4 : interval;
        if (harmony === 1) interval = interval === 10 ? 11 : interval;
        add('lead', base + beat, root + 12 + interval, 0.8, { duration: ASTRAL_BEAT * 1.4, pan: step % 2 ? -0.18 : 0.18 });
      }
    }
    if ([3, 15, 19, 31].includes(bar)) add('swell', base, 0, bar === 19 ? 1 : 0.5, { duration: 4 * ASTRAL_BEAT });
  }
  return events.sort((a, b) => a.time - b.time);
}

export function createAstralChart(difficulty = 'normal') {
  const priorities = { kick: 0, snare: 1, bass: 2, lead: 3, arp: 4, hat: 5 };
  const voices = difficulty === 'easy' ? ['kick', 'snare', 'lead'] : difficulty === 'hard' ? Object.keys(priorities) : ['kick', 'snare', 'bass', 'lead'];
  const candidates = createAstralScore().filter(event => voices.includes(event.voice) && event.beat >= 8 && event.beat < 140).sort((a, b) => a.time - b.time || priorities[a.voice] - priorities[b.voice]);
  const notes = [], lastLane = Array(4).fill(-Infinity);
  const gap = ASTRAL_BEAT * (difficulty === 'easy' ? 1.35 : difficulty === 'hard' ? 0.23 : 0.46);
  let previous = -Infinity, simultaneous = 0;
  for (const [index, event] of candidates.entries()) {
    const chord = Math.abs(event.time - previous) < 1e-8;
    const accent = Math.floor(event.beat / 4) % 4 === 3;
    const allowChord = difficulty === 'hard' || difficulty === 'normal' && accent && event.voice === 'snare';
    if (chord ? !allowChord || simultaneous >= 2 : event.time - previous < gap) continue;
    const startLane = event.voice === 'kick' ? Math.floor(event.beat / 4) % 2 * 3 : event.voice === 'snare' ? 1 + Math.floor(event.beat / 8) % 2 : (index + Math.floor(event.beat / 16)) % 4;
    const lane = Array.from({ length: 4 }, (_, i) => (startLane + i) % 4).find(lane => event.time - lastLane[lane] >= 0.2);
    if (lane === undefined) continue;
    notes.push({ time: event.time, lane, id: notes.length, judged: false });
    lastLane[lane] = event.time; previous = event.time;
    simultaneous = chord ? simultaneous + 1 : 1;
  }
  return notes;
}
