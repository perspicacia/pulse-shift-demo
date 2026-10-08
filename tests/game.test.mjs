import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, Session, createChart, DURATION } from '../src/game.js';
import { DIFFICULTIES } from '../src/game.js';

test('difficulty levels are 1, 2, and 3', () => {
  assert.deepEqual(Object.values(DIFFICULTIES).map(mode => mode.level), [1, 2, 3]);
});
test('sessions use the supplied chart and do not mutate reusable notes', () => {
  const chart = [{ time: 1.5, lane: 2 }, { time: 2, lane: 1 }];
  const first = new Session('easy', chart);
  first.hit(2, 1.5);
  assert.equal(first.score, 500000);
  assert.equal(chart[0].judged, undefined);
  const retry = new Session('easy', chart);
  assert.equal(retry.hit(2, 1.5).type, 'perfect');
  assert.equal(new Session('easy', []).score, 0);
});

test('early/late inclusive judgment boundaries and out-of-window presses', () => {
  for (const sign of [-1, 1]) {
    for (const [ms, expected] of [[0, 'perfect'], [45, 'perfect'], [45.01, 'great'], [90, 'great'], [90.01, 'good'], [140, 'good'], [140.01, null]]) assert.equal(judge(sign * ms), expected);
  }
});
test('charts are ordered, deterministic, fit in the music, and never duplicate a lane at a timestamp', () => {
  const sizes = [];
  for (const mode of ['easy', 'normal', 'hard']) {
    const chart = createChart(mode), unique = new Set();
    assert.deepEqual(chart, createChart(mode));
    assert.ok(chart[0].time > 3);
    chart.forEach((note, i) => {
      assert.ok(note.time < DURATION - 1);
      assert.ok(note.lane >= 0 && note.lane <= 3);
      assert.ok(i === 0 || chart[i - 1].time <= note.time);
      const key = `${note.time}:${note.lane}`;
      assert.ok(!unique.has(key)); unique.add(key);
    });
    sizes.push(chart.length);
  }
  assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2]);
});
test('a note can be scored once; an empty-lane press cannot create points', () => {
  const s = new Session(), first = s.notes[0];
  assert.equal(s.hit((first.lane + 1) % 4, first.time).type, 'empty');
  assert.equal(s.score, 0);
  assert.equal(s.hit(first.lane, first.time).type, 'perfect');
  const points = s.score;
  assert.equal(s.hit(first.lane, first.time).type, 'empty');
  assert.equal(s.score, points);
  assert.equal(s.combo, 0);
  assert.equal(s.emptyPresses, 2);
});
test('late hit at 140ms is valid, later than that becomes a miss even between frames', () => {
  const s = new Session(), first = s.notes[0];
  assert.equal(s.hit(first.lane, first.time + 0.14)?.type, 'good');
  const other = new Session(), note = other.notes[0];
  assert.equal(other.hit(note.lane, note.time + 0.141).type, 'empty');
  assert.equal(other.counts.miss, 1);
});
test('misses reset combo once and retain maximum combo', () => {
  const s = new Session();
  for (const note of s.notes.slice(0, 3)) s.hit(note.lane, note.time);
  assert.equal(s.combo, 3);
  s.expire(s.notes[3].time + 0.141);
  assert.equal(s.combo, 0);
  assert.equal(s.maxCombo, 3);
  const count = s.counts.miss;
  s.expire(s.notes[3].time + 0.141);
  assert.equal(s.counts.miss, count);
});
test('chords resolve independently, regardless of press order', () => {
  const s = new Session('hard');
  const chord = s.notes.filter((note, i, all) => all.some((other, j) => i !== j && note.time === other.time)).slice(0, 2);
  s.expire(chord[0].time - 0.001);
  for (const note of chord.toReversed()) assert.equal(s.hit(note.lane, note.time)?.type, 'perfect');
  assert.equal(s.combo, 2);
});
test('perfect finish gives exactly a million points and S; untouched play gives zero and D', () => {
  const s = new Session('hard');
  for (const note of s.notes) s.hit(note.lane, note.time);
  s.expire(DURATION + 1);
  assert.equal(s.score, 1000000);
  assert.equal(s.accuracy, 100);
  assert.equal(s.counts.miss, 0);
  assert.equal(s.maxCombo, s.notes.length);
  assert.equal(s.grade, 'S');
  const untouched = new Session();
  untouched.expire(DURATION + 1);
  assert.equal(untouched.processed, untouched.notes.length);
  assert.equal(untouched.score, 0);
  assert.equal(untouched.accuracy, 0);
  assert.equal(untouched.grade, 'D');
});
test('calibration offsets shift the judged song time, with positive values accepting later physical input', () => {
  const s = new Session(), first = s.notes[0];
  const physicalInputTime = first.time + 0.12;
  const calibration = 120;
  assert.equal(s.hit(first.lane, physicalInputTime - calibration / 1000).type, 'perfect');
});
test('combo rewards use actual hits at 10 then 50, 100 and 150 without duplicate resolution rewards', () => {
  const chart = Array.from({ length: 152 }, (_, i) => ({ time: i + 1, lane: i % 4 }));
  const session = new Session('normal', chart), rewards = [];
  assert.equal(session.nextComboMilestone, 10);
  chart.forEach((note, i) => {
    const event = session.hit(note.lane, note.time + (i % 3 === 0 ? .1 : i % 3 === 1 ? .07 : 0));
    if (event.comboMilestone) rewards.push(event.comboMilestone);
    assert.equal(session.resolve(session.notes[i], event.type, event.delta), null);
  });
  assert.deepEqual(rewards, [10, 50, 100, 150]);
  assert.ok(session.counts.good > 0 && session.counts.great > 0);
  assert.equal(session.nextComboMilestone, 0);
});

test('misses reset the combo but cannot repeat a milestone already rewarded in the same song', () => {
  const chart = Array.from({ length: 123 }, (_, i) => ({ time: i + 1, lane: 0 }));
  const session = new Session('normal', chart), rewards = [];
  chart.forEach((note, i) => {
    const event = i === 20 || i === 72 ? session.expire(note.time + .2).at(-1) : session.hit(0, note.time);
    if (event.comboMilestone) rewards.push(event.comboMilestone);
    if (event.type === 'miss') assert.equal(event.comboMilestone, 0);
  });
  assert.deepEqual(rewards, [10, 50]);
  assert.equal(session.counts.miss, 2);
  assert.equal(session.combo, 50);
});

test('retry starts a fresh combo reward schedule and short charts have no unreachable reward goal', () => {
  const chart = Array.from({ length: 10 }, (_, i) => ({ time: i + 1, lane: 0 }));
  const first = new Session('easy', chart);
  for (const note of chart) first.hit(0, note.time);
  assert.equal(first.nextComboMilestone, 0);
  const retry = new Session('easy', chart);
  assert.equal(retry.nextComboMilestone, 10);
  const rewards = chart.map(note => retry.hit(0, note.time).comboMilestone).filter(Boolean);
  assert.deepEqual(rewards, [10]);
  assert.equal(new Session('easy', chart.slice(0, 9)).nextComboMilestone, 0);
});
