import { buildChart } from './chart-builder.js';

export const PRISM_SONG = Object.freeze({ id: 'prism-rush', title: 'PRISM RUSH', artist: 'PULSE LAB', bpm: 172, bars: 48, genre: 'LIQUID DRUM & BASS' });
export const PRISM_BEAT = 60 / PRISM_SONG.bpm;
export const PRISM_DURATION = PRISM_SONG.bars * 4 * PRISM_BEAT + 3;

// Original liquid drum & bass: two-step drums, a rolling reese bass and bright
// chord stabs. One score drives both the rendered music and the playable notes.
export function createPrismScore() {
  const events = [], roots = [50, 46, 53, 48];
  const chords = [[0, 3, 7, 10, 14], [0, 4, 7, 11, 14], [0, 4, 7, 14, 16], [0, 5, 7, 10, 14]];
  const motif = [14, 10, 12, 7, 15, 14, 10, 19];
  const add = (voice, beat, pitch = 0, velocity = 1, extra = {}) => events.push({ voice, beat, time: beat * PRISM_BEAT, pitch, velocity, ...extra });
  for (let bar = 0; bar < PRISM_SONG.bars; bar++) {
    const base = bar * 4, harmony = Math.floor(bar / 2) % 4, root = roots[harmony];
    const intro = bar < 4, breakdown = bar >= 20 && bar < 28, build = bar === 26 || bar === 27, outro = bar >= 44;
    const drop = !intro && !breakdown && !outro, second = bar >= 28 && bar < 44;
    const energy = intro || outro ? 0.7 : 1;
    if (bar % 2 === 0) for (const [i, interval] of chords[harmony].entries()) {
      add('pad', base, root + 12 + interval, breakdown ? 1 : 0.7, { duration: 8 * PRISM_BEAT + 0.4, pan: [-0.7, 0.7, -0.35, 0.35, 0][i] });
    }
    if (bar % 4 === 0) add('air', base, 0, breakdown ? 0.8 : 0.3, { duration: 16 * PRISM_BEAT, pan: bar % 8 ? 0.6 : -0.6 });
    if (drop) {
      for (const beat of bar % 2 ? [0, 2.5, 2.75] : [0, 2.5]) add('kick', base + beat, 0, beat === 2.75 ? 0.75 : 1);
      for (const beat of [1, 3]) add('snare', base + beat, 0, 1);
      for (const beat of bar % 2 ? [1.75, 3.5] : [0.75, 3.75]) add('ghost', base + beat, 0, 0.5);
    } else if (outro || bar >= 2 && intro) add('kick', base, 0, energy);
    if (build) for (let step = 0; step < (bar === 26 ? 4 : 8); step++) {
      add('snare', base + step * (bar === 26 ? 1 : 0.5), 0, 0.55 + step * 0.06);
    }
    if (!breakdown || build) for (let step = 0; step < 8; step++) {
      add('hat', base + step / 2, 0, (step % 2 ? 0.75 : 0.4) * energy, { open: drop && step === 7, pan: step % 2 ? 0.3 : -0.3 });
    }
    if (drop) for (const [beat, length, step] of [[0, 1.5, 0], [1.5, 0.5, 7], [2.5, 1, 0], [3.5, 0.5, bar % 2 ? 10 : 12]]) {
      add('bass', base + beat, root - 24 + step, 1, { duration: length * PRISM_BEAT });
    }
    if (drop) for (const beat of bar % 2 ? [0.75, 2, 3.5] : [0.75, 2]) {
      add('stab', base + beat, root + 12, 0.85, { chord: chords[harmony].slice(0, 4), duration: PRISM_BEAT * 0.45, pan: beat === 2 ? 0.25 : -0.25 });
    }
    if (breakdown || second) for (let step = 0; step < 8; step++) {
      const interval = chords[harmony][(step + bar) % chords[harmony].length];
      add('arp', base + step / 2, root + 24 + interval, (breakdown ? 0.8 : 0.5) * (step % 2 ? 0.8 : 1), { duration: PRISM_BEAT * 0.9, pan: step % 2 ? 0.5 : -0.5 });
    }
    if (second) for (const [step, beat] of [0, 0.75, 1.5, 2.5, 3].entries()) {
      if (bar % 2 && step > 2) continue;
      add('lead', base + beat, root + 12 + motif[(step + bar * 3) % motif.length], 0.8, { duration: PRISM_BEAT * (step === 2 ? 1 : 0.7) });
    }
    if ([3, 19, 27, 43].includes(bar)) add('swell', base, 0, bar === 27 ? 1 : 0.55, { duration: 4 * PRISM_BEAT });
  }
  return events.sort((a, b) => a.time - b.time);
}

export function createPrismChart(difficulty = 'normal') {
  const settings = {
    easy: { voices: ['kick', 'snare'], gapBeats: 1.4 },
    normal: { voices: ['kick', 'snare', 'stab', 'lead'], gapBeats: 0.5, chord: event => event.voice === 'snare' && Math.floor(event.beat / 4) % 4 === 3 },
    hard: { voices: ['kick', 'snare', 'stab', 'lead', 'ghost', 'arp', 'hat'], gapBeats: 0.25, chord: event => ['snare', 'stab', 'lead', 'ghost'].includes(event.voice) },
  }[difficulty];
  return buildChart(createPrismScore(), {
    beat: PRISM_BEAT, from: 8, to: 176, ...settings,
    anchors: difficulty === 'easy' ? {} : { kick: [0, 3], snare: [1, 2] },
  });
}
