import { buildChart } from './chart-builder.js';

export const BLOOM_SONG = Object.freeze({ id: 'neon-bloom', title: 'NEON BLOOM', artist: 'PULSE LAB', bpm: 112, bars: 32, genre: 'FUTURE FUNK / NU-DISCO' });
export const BLOOM_BEAT = 60 / BLOOM_SONG.bpm;
export const BLOOM_DURATION = BLOOM_SONG.bars * 4 * BLOOM_BEAT + 3;

// Original nu-disco: four-on-the-floor drums, a syncopated octave bass and
// electric-piano chords over a IVmaj7–iii7–ii7–V7 loop.
export function createBloomScore() {
  const events = [], roots = [53, 52, 50, 55];
  const chords = [[0, 4, 7, 11, 14], [0, 3, 7, 10, 14], [0, 3, 7, 10, 14], [0, 4, 7, 10, 14]];
  const melody = [[0, 12], [0.75, 14], [1.5, 16], [2.5, 19], [3, 16], [3.5, 14]];
  const answer = [[0.5, 11], [1, 12], [2, 7], [2.75, 9], [3.5, 12]];
  const add = (voice, beat, pitch = 0, velocity = 1, extra = {}) => events.push({ voice, beat, time: beat * BLOOM_BEAT, pitch, velocity, ...extra });
  for (let bar = 0; bar < BLOOM_SONG.bars; bar++) {
    const base = bar * 4, harmony = bar % 4, root = roots[harmony];
    const intro = bar < 4, breakdown = bar >= 16 && bar < 20, outro = bar >= 28;
    const groove = !intro && !breakdown, lead = bar >= 12 && bar < 16 || bar >= 20 && bar < 28;
    const energy = intro || outro ? 0.7 : 1;
    for (const [i, interval] of chords[harmony].slice(0, 4).entries()) {
      add('pad', base, root + interval, breakdown ? 1 : 0.65, { duration: 4 * BLOOM_BEAT + 0.3, pan: [-0.6, 0.6, -0.3, 0.3][i] });
    }
    if (bar % 4 === 0) add('air', base, 0, breakdown ? 0.7 : 0.25, { duration: 16 * BLOOM_BEAT, pan: bar % 8 ? 0.5 : -0.5 });
    if (groove) for (let beat = 0; beat < 4; beat++) add('kick', base + beat, 0, energy * (beat ? 0.9 : 1));
    else if (intro && bar >= 2 || breakdown && bar >= 18) for (const beat of [0, 2]) add('kick', base + beat, 0, 0.7);
    if (groove || breakdown) for (const beat of [1, 3]) add('clap', base + beat, 0, breakdown ? 0.6 : energy);
    if (groove) for (let step = 0; step < 4; step++) add('hat', base + step + 0.5, 0, 0.75 * energy, { open: true, pan: step % 2 ? 0.35 : -0.35 });
    if (!breakdown) for (let step = 0; step < 16; step++) {
      if (step % 4 === 2) continue;
      add('shaker', base + step / 4, 0, (step % 2 ? 0.55 : 0.3) * energy, { pan: 0.45 });
    }
    if (!intro) for (const [beat, step, length] of [[0, 0, 0.5], [0.75, 12, 0.25], [1.5, 0, 0.5], [2.25, 7, 0.25], [2.75, 12, 0.25], [3.5, bar % 2 ? 10 : 0, 0.4]]) {
      if (breakdown && beat % 1) continue;
      add('bass', base + beat, root - 24 + step, breakdown ? 0.75 : 1, { duration: length * BLOOM_BEAT + 0.04 });
    }
    for (const beat of intro || breakdown ? [0, 2.5] : [0.5, 1.25, 2.5, 3.25]) {
      add('keys', base + beat, root + 12, intro || breakdown ? 0.9 : 0.75, { chord: chords[harmony], duration: BLOOM_BEAT * (intro || breakdown ? 1.8 : 0.55), pan: beat < 2 ? -0.2 : 0.2 });
    }
    if (lead) for (const [beat, interval] of bar % 2 ? answer : melody) {
      add('lead', base + beat, roots[0] + 12 + interval, 0.8, { duration: BLOOM_BEAT * 0.6, pan: 0.12 });
    }
    if ([3, 15, 19, 27].includes(bar)) add('swell', base, 0, bar === 19 ? 1 : 0.5, { duration: 4 * BLOOM_BEAT });
  }
  return events.sort((a, b) => a.time - b.time);
}

export function createBloomChart(difficulty = 'normal') {
  const settings = {
    easy: { voices: ['kick', 'clap', 'lead'], gapBeats: 1.5 },
    // The backbeat clap outranks the kick it lands on, so both hands share the groove.
    normal: { voices: ['clap', 'kick', 'keys', 'lead'], gapBeats: 0.5, chord: event => event.voice === 'kick' && Math.floor(event.beat / 4) % 4 === 3 },
    hard: { voices: ['clap', 'kick', 'keys', 'lead', 'bass', 'hat'], gapBeats: 0.25, chord: event => ['kick', 'keys'].includes(event.voice) },
  }[difficulty];
  return buildChart(createBloomScore(), {
    beat: BLOOM_BEAT, from: 8, to: 120, ...settings,
    anchors: difficulty === 'easy' ? {} : { kick: [0, 3], clap: [1, 2] },
  });
}
