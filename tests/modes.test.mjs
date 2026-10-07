import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, DURATION } from '../src/game.js';
import { BUILTIN_TRACKS } from '../src/tracks.js';
import { chartFor, createSixKeyChart, createAstralSixKeyChart, keysFor, modeRecordKey, sixKeyDifficulty } from '../src/modes.js';
import { ASTRAL_DURATION, createAstralScore } from '../src/astral-score.js';

test('4-key mapping and authored charts remain unchanged; experimental keys split across two hands', () => {
  assert.deepEqual(keysFor(), ['KeyD', 'KeyF', 'KeyJ', 'KeyK']);
  assert.deepEqual(keysFor(6), ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL']);
  for (const track of BUILTIN_TRACKS) for (const level of ['easy', 'normal', 'hard']) assert.equal(chartFor(track, 4, level), track.charts[level]);
  assert.throws(() => keysFor(5), RangeError);
});

test('six-key chart uses only authored original beats, all six lanes, and one/two-note chords', () => {
  const chart = createSixKeyChart(), authoredTimes = new Set(BUILTIN_TRACKS[0].charts.easy.map(note => note.time));
  assert.deepEqual(chart, createSixKeyChart());
  assert.deepEqual([...new Set(chart.map(note => note.lane))].sort(), [0, 1, 2, 3, 4, 5]);
  const groups = new Map(), lanes = Array(6).fill(-Infinity);
  for (const [index, note] of chart.entries()) {
    assert.ok(authoredTimes.has(note.time)); assert.ok(note.time > 3 && note.time < DURATION - 1);
    assert.ok(index === 0 || chart[index - 1].time <= note.time);
    assert.ok(note.time - lanes[note.lane] >= 0.2); lanes[note.lane] = note.time;
    const chord = groups.get(note.time) || []; assert.ok(!chord.includes(note.lane)); chord.push(note.lane); groups.set(note.time, chord);
  }
  assert.ok([...groups.values()].some(chord => chord.length === 2));
  assert.ok([...groups.values()].every(chord => chord.length >= 1 && chord.length <= 2));
});

test('six-key experiment is limited to the explicitly authored song/level combinations', () => {
  assert.deepEqual(chartFor(BUILTIN_TRACKS[0], 6, 'easy'), createSixKeyChart());
  assert.deepEqual(chartFor(BUILTIN_TRACKS[2], 6, 'hard'), createAstralSixKeyChart());
  assert.equal(sixKeyDifficulty('afterglow'), 'easy');
  assert.equal(sixKeyDifficulty('astral-veil'), 'hard');
  assert.equal(sixKeyDifficulty('tidal-circuit'), null);
  assert.throws(() => chartFor(BUILTIN_TRACKS[1], 6, 'easy'), RangeError);
  assert.throws(() => chartFor({ id: 'unknown-track', charts: {} }, 6, 'easy'), RangeError);
  assert.throws(() => chartFor(BUILTIN_TRACKS[0], 6, 'normal'), RangeError);
  assert.throws(() => chartFor(BUILTIN_TRACKS[2], 6, 'easy'), RangeError);
  assert.throws(() => chartFor(BUILTIN_TRACKS[2], 6, 'normal'), RangeError);
});

test('Astral six-key hard uses authored onsets, all lanes and playable unique three-key chords', () => {
  const chart = createAstralSixKeyChart(), authored = new Set(createAstralScore().map(event => event.time));
  assert.deepEqual(chart, createAstralSixKeyChart());
  assert.ok(chart.length > BUILTIN_TRACKS[2].charts.hard.length);
  assert.deepEqual([...new Set(chart.map(note => note.lane))].sort(), [0, 1, 2, 3, 4, 5]);
  const groups = new Map(), lanes = Array(6).fill(-Infinity);
  for (const [index, note] of chart.entries()) {
    assert.ok(authored.has(note.time));
    assert.ok(note.time > 3 && note.time < ASTRAL_DURATION - 1);
    assert.ok(!index || chart[index - 1].time <= note.time);
    assert.ok(note.time - lanes[note.lane] >= 0.18); lanes[note.lane] = note.time;
    const chord = groups.get(note.time) || [];
    assert.ok(!chord.includes(note.lane)); chord.push(note.lane); groups.set(note.time, chord);
  }
  assert.ok([...groups.values()].some(chord => chord.length === 3));
  assert.ok([...groups.values()].every(chord => chord.length <= 3));
});

test('Astral six-key hard perfect demo resolves every note with the normal score and judgment', () => {
  const chart = createAstralSixKeyChart(), session = new Session('hard', chart);
  for (const note of chart) {
    assert.equal(session.hit(note.lane, note.time)?.type, 'perfect');
    assert.equal(session.hit(note.lane, note.time), null);
  }
  session.expire(ASTRAL_DURATION + 1);
  assert.deepEqual(session.counts, { perfect: chart.length, great: 0, good: 0, miss: 0 });
  assert.equal(session.score, 1000000); assert.equal(session.accuracy, 100);
  assert.equal(session.maxCombo, chart.length); assert.equal(session.grade, 'S');
  assert.notEqual(modeRecordKey('astral-veil', 'hard', 6), modeRecordKey('astral-veil', 'hard', 4));
});

test('six-key perfect play scores exactly one million, duplicate input cannot score, retry starts clean', () => {
  const chart = createSixKeyChart(), session = new Session('easy', chart);
  for (const note of chart) {
    assert.equal(session.hit(note.lane, note.time)?.type, 'perfect');
    const score = session.score;
    assert.equal(session.hit(note.lane, note.time), null); assert.equal(session.score, score);
  }
  session.expire(DURATION + 1);
  assert.equal(session.score, 1000000); assert.equal(session.accuracy, 100); assert.equal(session.grade, 'S');
  assert.equal(session.maxCombo, chart.length); assert.equal(session.counts.miss, 0);
  const retry = new Session('easy', chart); assert.equal(retry.score, 0); assert.equal(retry.processed, 0);
});

test('same-track 4/6-key and difficulty records have distinct persistent identities', () => {
  const keys = [modeRecordKey('afterglow', 'easy', 4), modeRecordKey('afterglow', 'easy', 6), modeRecordKey('afterglow', 'normal', 4), modeRecordKey('tidal-circuit', 'easy', 4)];
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(modeRecordKey('afterglow', 'easy', 6), 'afterglow:6k:easy');
});
