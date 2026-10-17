import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChart } from '../src/chart-builder.js';
import { PRISM_BEAT, PRISM_DURATION, createPrismScore, createPrismChart } from '../src/prism-score.js';
import { BLOOM_BEAT, BLOOM_DURATION, createBloomScore, createBloomChart } from '../src/bloom-score.js';
import { synthesizePrism } from '../src/synth-prism.js';
import { synthesizeBloom } from '../src/synth-bloom.js';
import { BUILTIN_TRACKS } from '../src/tracks.js';
import { Session } from '../src/game.js';

const songs = [
  { id: 'prism-rush', beat: PRISM_BEAT, duration: PRISM_DURATION, score: createPrismScore, chart: createPrismChart, synth: synthesizePrism },
  { id: 'neon-bloom', beat: BLOOM_BEAT, duration: BLOOM_DURATION, score: createBloomScore, chart: createBloomChart, synth: synthesizeBloom },
];

test('chart builder rotates unanchored voices, keeps anchors, caps chords and same-lane gaps', () => {
  const beat = 0.5, at = (voice, b) => ({ voice, beat: b, time: b * beat });
  const score = [at('kick', 0), at('snare', 1), at('lead', 1), at('kick', 2), at('lead', 2.5), at('lead', 3), at('lead', 3.5), at('lead', 3.5), at('lead', 3.5)];
  const chart = buildChart(score, { beat, voices: ['kick', 'snare', 'lead'], gapBeats: 0.5, from: 0, to: 8, anchors: { kick: [0, 3], snare: [1, 2] }, chord: event => event.voice === 'lead' });
  // Kicks alternate 0/3, the snare takes 1, leads rotate 0→2→1→3, and a third chord note is dropped.
  assert.deepEqual(chart.map(note => [note.time, note.lane]), [[0, 0], [0.5, 1], [0.5, 0], [1, 3], [1.25, 2], [1.5, 1], [1.75, 3], [1.75, 0]]);
  assert.ok(chart.every((note, id) => note.id === id && note.judged === false));
  // A lane hit 150 ms ago is skipped for the next free one.
  const close = buildChart([at('kick', 0), at('lead', 0.3)], { beat, voices: ['kick', 'lead'], gapBeats: 0.25, from: 0, to: 8, anchors: { kick: [0, 3] } });
  assert.deepEqual(close.map(note => note.lane), [0, 1]);
});

for (const song of songs) {
  test(`${song.id} charts follow authored onsets, balance all four lanes, and finish perfectly`, () => {
    const score = song.score(), onsets = new Set(score.map(event => event.time)), sizes = [];
    assert.deepEqual(score, song.score());
    for (const mode of ['easy', 'normal', 'hard']) {
      const chart = song.chart(mode), lastLane = Array(4).fill(-Infinity), lanes = Array(4).fill(0), seen = new Set();
      let simultaneous = 0;
      assert.deepEqual(chart, song.chart(mode));
      sizes.push(chart.length);
      for (const [index, note] of chart.entries()) {
        assert.ok(onsets.has(note.time));
        assert.ok(note.time >= 8 * song.beat && note.time < song.duration - 3);
        assert.ok(index === 0 || chart[index - 1].time <= note.time);
        assert.ok(note.time - lastLane[note.lane] >= 0.2 - 1e-9);
        simultaneous = index && note.time === chart[index - 1].time ? simultaneous + 1 : 1;
        assert.ok(simultaneous <= (mode === 'easy' ? 1 : 2));
        const key = `${note.time}:${note.lane}`;
        assert.ok(!seen.has(key)); seen.add(key);
        lastLane[note.lane] = note.time; lanes[note.lane]++;
      }
      // No lane may be starved the way ASTRAL LEVEL 1 once was (25/1/2/35).
      assert.ok(Math.min(...lanes) >= chart.length * 0.15, `${mode} lanes ${lanes.join('/')}`);
      const session = new Session(mode, chart);
      for (const note of chart) assert.equal(session.hit(note.lane, note.time).type, 'perfect');
      assert.equal(session.score, 1000000); assert.equal(session.counts.miss, 0);
    }
    assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2]);
  });

  test(`${song.id} renders bounded stereo PCM with a clean start and ending`, () => {
    const rate = 11025, { left, right, sampleRate } = song.synth(rate);
    assert.equal(sampleRate, rate);
    assert.equal(left.length, Math.ceil(song.duration * rate));
    assert.equal(right.length, left.length);
    let power = 0, stereoDifference = 0, peak = 0;
    for (let i = 0; i < left.length; i++) {
      assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      power += left[i] ** 2 + right[i] ** 2;
      stereoDifference += (left[i] - right[i]) ** 2;
    }
    assert.ok(peak > 0.4 && peak <= 0.83);
    assert.ok(Math.sqrt(power / (left.length * 2)) > 0.04);
    assert.ok(stereoDifference / left.length > 0.0001);
    assert.equal(Math.abs(left[0]), 0); assert.equal(Math.abs(left.at(-1)), 0);
    assert.equal(Math.abs(right[0]), 0); assert.equal(Math.abs(right.at(-1)), 0);
  });
}

test('new tracks are in the catalog with their own art, numbering and preview inside the music', () => {
  for (const [index, id] of [[3, 'prism-rush'], [4, 'neon-bloom']]) {
    const track = BUILTIN_TRACKS[index];
    assert.equal(track.id, id);
    assert.equal(track.number, `00${index + 1}`);
    assert.match(track.cover, new RegExp(`${id}\\.svg$`));
    assert.ok((track.previewBeat + 32) * 60 / track.bpm < track.duration);
  }
});
