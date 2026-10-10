import test from 'node:test';
import assert from 'node:assert/strict';
import { SUNSET_SONG, SUNSET_BEAT, SUNSET_DURATION, createSunsetScore, createSunsetChart } from '../src/sunset-score.js';
import { synthesizeSunset } from '../src/synth-sunset.js';
import { Session } from '../src/game.js';

test('SUNSET SIP charts use audible score onsets and complete at all three levels', () => {
  const score = createSunsetScore(), chartable = new Set(score.filter(event => ['kick', 'snare', 'keys', 'lead', 'bass', 'rim', 'shaker'].includes(event.voice) && event.chartable !== false).map(event => event.time));
  assert.deepEqual(score, createSunsetScore());
  const sizes = [];
  for (const difficulty of ['easy', 'normal', 'hard']) {
    const chart = createSunsetChart(difficulty), session = new Session(difficulty, chart);
    const lastLane = Array(4).fill(-Infinity), seen = new Set();
    let simultaneous = 0;
    assert.deepEqual(chart, createSunsetChart(difficulty));
    for (const [index, note] of chart.entries()) {
      assert.ok(chartable.has(note.time));
      assert.ok(note.time >= 8 * SUNSET_BEAT && note.time < 124 * SUNSET_BEAT);
      assert.ok(Number.isInteger(note.lane) && note.lane >= 0 && note.lane < 4);
      assert.ok(index === 0 || chart[index - 1].time <= note.time);
      assert.ok(note.time - lastLane[note.lane] >= 0.2 - 1e-9);
      assert.ok(!seen.has(`${note.time}:${note.lane}`));
      seen.add(`${note.time}:${note.lane}`); lastLane[note.lane] = note.time;
      simultaneous = index && chart[index - 1].time === note.time ? simultaneous + 1 : 1;
      assert.ok(simultaneous <= (difficulty === 'easy' ? 1 : 2));
      assert.equal(session.hit(note.lane, note.time).type, 'perfect');
    }
    assert.deepEqual(session.finish(SUNSET_DURATION), []);
    assert.equal(session.counts.perfect, chart.length); assert.equal(session.counts.miss, 0);
    assert.equal(session.score, 1000000); assert.equal(session.fullCombo, true);
    assert.ok(chart.every(note => !note.judged));
    sizes.push(chart.length);
  }
  assert.ok(sizes[0] > 30 && sizes[0] < sizes[1] && sizes[1] < sizes[2]);
});

test('SUNSET SIP has authored harmony, swing, and five distinct musical sections', () => {
  const score = createSunsetScore();
  assert.equal(SUNSET_SONG.bpm, 106);
  assert.ok(SUNSET_DURATION >= 64 && SUNSET_DURATION <= 80);
  assert.deepEqual([...new Set(score.map(event => event.section))], ['intro', 'groove', 'break', 'return', 'outro']);
  assert.ok(score.some(event => event.voice === 'shaker' && Math.abs(event.beat % 1 - 0.58) < 1e-8));
  const breakEvents = score.filter(event => event.section === 'break');
  assert.equal(breakEvents.filter(event => event.voice === 'snare').length, 0);
  assert.ok(score.some(event => event.section === 'return' && event.voice === 'snare'));
  assert.equal(new Set(score.filter(event => event.voice === 'keys' && event.beat < 1).map(event => event.pitch)).size, 4);
});

test('SUNSET SIP renders finite stereo PCM, headroom, audible groove, and a quiet break', () => {
  const rate = 11025, { left, right, sampleRate } = synthesizeSunset(rate);
  assert.equal(sampleRate, rate); assert.equal(left.length, Math.ceil(SUNSET_DURATION * rate));
  assert.equal(right.length, left.length);
  let peak = 0, power = 0, difference = 0;
  for (let i = 0; i < left.length; i++) {
    assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    power += left[i] ** 2 + right[i] ** 2;
    difference += (left[i] - right[i]) ** 2;
  }
  const rms = (firstBar, lastBar) => {
    const from = Math.round(firstBar * 4 * SUNSET_BEAT * rate), to = Math.round(lastBar * 4 * SUNSET_BEAT * rate);
    let sum = 0;
    for (let i = from; i < to; i++) sum += left[i] ** 2 + right[i] ** 2;
    return Math.sqrt(sum / ((to - from) * 2));
  };
  assert.ok(peak > 0.35 && peak < 0.83);
  assert.ok(Math.sqrt(power / (left.length * 2)) > 0.035);
  assert.ok(difference / left.length > 0.00005);
  assert.ok(rms(14, 18) < rms(18, 22) * 0.85);
  assert.equal(Math.abs(left[0]), 0); assert.equal(Math.abs(right[0]), 0);
  assert.equal(Math.abs(left.at(-1)), 0); assert.equal(Math.abs(right.at(-1)), 0);
});

test('SUNSET SIP synthesis is deterministic and accepts a different PCM sample rate', () => {
  const first = synthesizeSunset(4000), second = synthesizeSunset(4000);
  assert.equal(first.sampleRate, 4000);
  assert.deepEqual(first.left, second.left); assert.deepEqual(first.right, second.right);
});
