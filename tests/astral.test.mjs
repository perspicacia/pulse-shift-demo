import test from 'node:test';
import assert from 'node:assert/strict';
import { ASTRAL_BEAT, ASTRAL_DURATION, createAstralScore, createAstralChart } from '../src/astral-score.js';
import { synthesizeAstral } from '../src/synth-astral.js';
import { Session } from '../src/game.js';

test('ASTRAL VEIL charts share musical onsets and finish at all three difficulty levels', () => {
  const score = createAstralScore(), sizes = [];
  const onsets = new Set(score.filter(event => ['kick', 'snare', 'bass', 'lead', 'arp', 'hat'].includes(event.voice)).map(event => event.time));
  assert.deepEqual(score, createAstralScore());
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const chart = createAstralChart(difficulty), lastLane = Array(4).fill(-Infinity);
    const session = new Session(difficulty, chart), seen = new Set();
    let simultaneous = 0;
    sizes.push(chart.length);
    assert.deepEqual(chart, createAstralChart(difficulty));
    for (const [index, note] of chart.entries()) {
      assert.ok(onsets.has(note.time));
      assert.ok(Number.isInteger(note.lane) && note.lane >= 0 && note.lane < 4);
      assert.ok(note.time >= 8 * ASTRAL_BEAT && note.time < 140 * ASTRAL_BEAT);
      assert.ok(index === 0 || chart[index - 1].time <= note.time);
      assert.ok(note.time - lastLane[note.lane] >= 0.2 - 1e-9);
      simultaneous = index && note.time === chart[index - 1].time ? simultaneous + 1 : 1;
      assert.ok(simultaneous <= (difficulty === 'easy' ? 1 : 2));
      const key = `${note.time}:${note.lane}`;
      assert.ok(!seen.has(key)); seen.add(key); lastLane[note.lane] = note.time;
      assert.equal(session.hit(note.lane, note.time).type, 'perfect');
    }
    assert.deepEqual(session.expire(ASTRAL_DURATION), []);
    assert.equal(session.score, 1000000); assert.equal(session.counts.miss, 0);
    assert.equal(session.counts.perfect, chart.length);
    assert.ok(chart.every(note => !note.judged));
  }
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2]);
});

test('ASTRAL VEIL has a quieter interlude, a returning beat, and a finite stereo tail', () => {
  const rate = 11025, { left, right, sampleRate } = synthesizeAstral(rate);
  assert.equal(sampleRate, rate);
  assert.equal(left.length, Math.ceil(ASTRAL_DURATION * rate));
  assert.equal(right.length, left.length);
  let peak = 0, difference = 0;
  for (let i = 0; i < left.length; i++) {
    assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    difference += (left[i] - right[i]) ** 2;
  }
  const rms = (firstBeat, lastBeat) => {
    const first = Math.round(firstBeat * ASTRAL_BEAT * rate), last = Math.round(lastBeat * ASTRAL_BEAT * rate);
    let power = 0;
    for (let i = first; i < last; i++) power += left[i] ** 2 + right[i] ** 2;
    return Math.sqrt(power / ((last - first) * 2));
  };
  assert.ok(peak > 0.4 && peak <= 0.84);
  assert.ok(difference / left.length > 0.0001);
  assert.ok(rms(80, 96) > 0.07);
  assert.ok(rms(64, 80) < rms(80, 96) * 0.9);
  assert.equal(Math.abs(left[0]), 0); assert.equal(Math.abs(right[0]), 0);
  assert.equal(Math.abs(left.at(-1)), 0); assert.equal(Math.abs(right.at(-1)), 0);
});
