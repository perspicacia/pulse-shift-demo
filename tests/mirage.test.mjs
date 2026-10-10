import test from 'node:test';
import assert from 'node:assert/strict';
import { MIRAGE_SONG, MIRAGE_BEAT, MIRAGE_DURATION, createMirageScore, createMirageChart } from '../src/mirage-score.js';
import { synthesizeMirage } from '../src/synth-mirage.js';
import { Session } from '../src/game.js';

test('MIRAGE BLOOM charts follow original instrumental attacks and finish perfectly', () => {
  const score = createMirageScore(), sizes = [];
  const onsets = new Set(score.filter(event => ['kick', 'dum', 'tak', 'flute', 'pluck', 'bass', 'shaker'].includes(event.voice)).map(event => event.time));
  assert.equal(MIRAGE_SONG.bpm, 112);
  assert.ok(MIRAGE_DURATION >= 65 && MIRAGE_DURATION <= 80);
  assert.deepEqual(score, createMirageScore());
  for (const event of score) {
    assert.equal(event.time, event.beat * MIRAGE_BEAT);
    assert.ok(Number.isFinite(event.pitch) && Number.isFinite(event.velocity));
    assert.ok(event.time >= 0 && event.time < MIRAGE_DURATION);
  }
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const chart = createMirageChart(difficulty), lastLane = Array(4).fill(-Infinity), seen = new Set();
    const session = new Session(difficulty, chart);
    let simultaneous = 0;
    sizes.push(chart.length);
    assert.deepEqual(chart, createMirageChart(difficulty));
    for (const [index, note] of chart.entries()) {
      assert.ok(onsets.has(note.time));
      assert.ok(Number.isInteger(note.lane) && note.lane >= 0 && note.lane < 4);
      assert.ok(note.time >= 8 * MIRAGE_BEAT && note.time < 124 * MIRAGE_BEAT);
      assert.ok(index === 0 || chart[index - 1].time <= note.time);
      assert.ok(note.time - lastLane[note.lane] >= 0.2 - 1e-9);
      simultaneous = index && note.time === chart[index - 1].time ? simultaneous + 1 : 1;
      assert.ok(simultaneous <= (difficulty === 'easy' ? 1 : 2));
      const key = `${note.time}:${note.lane}`;
      assert.ok(!seen.has(key)); seen.add(key); lastLane[note.lane] = note.time;
      assert.equal(session.hit(note.lane, note.time).type, 'perfect');
    }
    session.finish(MIRAGE_DURATION);
    assert.equal(session.score, 1000000);
    assert.equal(session.maxCombo, chart.length);
    assert.equal(session.counts.miss, 0);
    assert.equal(session.fullCombo, true);
    assert.ok(chart.every(note => !note.judged));
  }
  assert.ok(sizes[0] >= 60 && sizes[0] < sizes[1] && sizes[1] < sizes[2]);
});

test('MIRAGE BLOOM score leaves a quieter bridge with a distinct return', () => {
  const score = createMirageScore();
  const inBars = (from, to) => score.filter(event => event.beat >= from * 4 && event.beat < to * 4);
  assert.ok(inBars(12, 16).filter(event => event.voice === 'kick').length < inBars(16, 20).filter(event => event.voice === 'kick').length);
  assert.equal(inBars(12, 16).filter(event => event.voice === 'bass' || event.voice === 'shaker').length, 0);
  assert.ok(inBars(16, 20).some(event => event.voice === 'bass'));
  assert.ok(score.some(event => Math.abs(event.beat * 2 - Math.round(event.beat * 2)) > 0.01));
});

test('MIRAGE BLOOM renders deterministic bounded stereo with audible passages and a clean tail', () => {
  const rate = 11025, first = synthesizeMirage(rate), repeat = synthesizeMirage(rate);
  const { left, right, sampleRate } = first;
  assert.equal(sampleRate, rate);
  assert.equal(left.length, Math.ceil(MIRAGE_DURATION * rate));
  assert.equal(right.length, left.length);
  assert.deepEqual(first.left, repeat.left);
  assert.deepEqual(first.right, repeat.right);
  let power = 0, stereoDifference = 0, peak = 0;
  for (let index = 0; index < left.length; index++) {
    assert.ok(Number.isFinite(left[index]) && Number.isFinite(right[index]));
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
    power += left[index] ** 2 + right[index] ** 2;
    stereoDifference += (left[index] - right[index]) ** 2;
  }
  assert.ok(peak > 0.4 && peak <= 0.84);
  assert.ok(Math.sqrt(power / (left.length * 2)) > 0.04);
  assert.ok(stereoDifference / left.length > 0.0001);
  for (const [from, to] of [[0, 8], [12 * 4 * MIRAGE_BEAT, 16 * 4 * MIRAGE_BEAT], [20 * 4 * MIRAGE_BEAT, 24 * 4 * MIRAGE_BEAT]]) {
    let sum = 0, frames = 0;
    for (let index = Math.floor(from * rate); index < Math.floor(to * rate); index++) { sum += left[index] ** 2 + right[index] ** 2; frames++; }
    assert.ok(Math.sqrt(sum / (frames * 2)) > 0.025);
  }
  assert.equal(Math.abs(left[0]), 0); assert.equal(Math.abs(right[0]), 0);
  assert.equal(Math.abs(left.at(-1)), 0); assert.equal(Math.abs(right.at(-1)), 0);
});
