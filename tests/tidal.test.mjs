import test from 'node:test';
import assert from 'node:assert/strict';
import { TIDAL_BEAT, TIDAL_DURATION, createTidalScore, createTidalChart } from '../src/tidal-score.js';
import { synthesizeTidal } from '../src/synth-tidal.js';
import { BUILTIN_TRACKS } from '../src/tracks.js';
import { Session } from '../src/game.js';

test('new track charts follow authored instrument onsets, have three densities, and can finish perfectly', () => {
  const score = createTidalScore(), onsets = new Set(score.filter(event => ['kick', 'snare', 'pluck', 'hat', 'rim'].includes(event.voice)).map(event => event.time));
  const sizes = [];
  assert.deepEqual(score, createTidalScore());
  assert.ok(score.some(event => Math.abs(event.beat * 2 - Math.round(event.beat * 2)) > 0.01));
  for (const mode of ['easy', 'normal', 'hard']) {
    const chart = createTidalChart(mode), seen = new Set(), lastLane = [-Infinity, -Infinity, -Infinity, -Infinity];
    sizes.push(chart.length);
    assert.deepEqual(chart, createTidalChart(mode));
    chart.forEach((note, i) => {
      assert.ok(onsets.has(note.time));
      assert.ok(note.time >= 8 * TIDAL_BEAT && note.time < TIDAL_DURATION - 3);
      assert.ok(i === 0 || chart[i - 1].time <= note.time);
      assert.ok(note.time - lastLane[note.lane] >= 0.2 - 1e-9);
      const key = `${note.time}:${note.lane}`;
      assert.ok(!seen.has(key)); seen.add(key); lastLane[note.lane] = note.time;
    });
    const session = new Session(mode, chart);
    for (const note of chart) assert.equal(session.hit(note.lane, note.time).type, 'perfect');
    assert.equal(session.score, 1000000); assert.equal(session.counts.miss, 0);
    assert.ok(chart.every(note => !note.judged));
  }
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2]);
});

test('original tracks have separate identities, music lengths, charts, and preview positions', () => {
  assert.equal(BUILTIN_TRACKS.length, 3);
  assert.equal(new Set(BUILTIN_TRACKS.map(track => track.id)).size, 3);
  assert.equal(new Set(BUILTIN_TRACKS.map(track => track.buttonId)).size, 3);
  assert.equal(new Set(BUILTIN_TRACKS.map(track => track.cover)).size, 3);
  assert.notEqual(BUILTIN_TRACKS[0].duration, BUILTIN_TRACKS[1].duration);
  for (const track of BUILTIN_TRACKS) {
    assert.ok(track.previewBeat * 60 / track.bpm < track.duration);
    assert.ok(track.cover && track.description);
    assert.ok(track.charts.easy.length < track.charts.normal.length && track.charts.normal.length < track.charts.hard.length);
  }
});

test('new composition renders bounded stereo PCM with an audible groove and a clean ending', () => {
  const rate = 11025, { left, right, sampleRate } = synthesizeTidal(rate);
  assert.equal(sampleRate, rate);
  assert.equal(left.length, Math.ceil(TIDAL_DURATION * rate));
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
