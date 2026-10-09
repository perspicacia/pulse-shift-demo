import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatures, analyzeFeatures, validateFile, validateAudio, validateCalibration, createPersonalChart, personalRevision, makePersonalTrack, personalTestRange, FILE_LIMIT } from '../src/personal-analysis.js';
import { chartFor, keysFor } from '../src/modes.js';
import { Session } from '../src/game.js';
import { analyzeAudio } from '../src/personal-music.js';

function clicks(bpm = 120, duration = 32, first = .75) {
  const sampleRate = 12000, samples = new Float32Array(sampleRate * duration);
  for (let time = first; time < duration - .2; time += 60 / bpm) for (let i = 0; i < sampleRate * .055; i++) {
    samples[Math.floor(time * sampleRate) + i] += .8 * Math.cos(i / sampleRate * 2 * Math.PI * 180) * Math.exp(-i / sampleRate * 60);
  }
  return { samples, sampleRate };
}
const analyze = fixture => analyzeFeatures(extractFeatures([fixture.samples], fixture.sampleRate));

for (const bpm of [90, 120, 128.5, 160]) test(`known ${bpm} BPM and silent intro stay aligned through the song`, () => {
  const analysis = analyze(clicks(bpm));
  assert.ok(Math.abs(analysis.bpm - bpm) < .03, `BPM ${analysis.bpm}`);
  assert.ok(Math.abs(analysis.firstBeat - .75) < .008);
  assert.ok(analysis.confidence > .65); assert.equal(analysis.unstable, false);
  const lastBeat = Math.floor((31 - .75) / (60 / bpm));
  assert.ok(Math.abs(analysis.firstBeat + lastBeat * 60 / analysis.bpm - (.75 + lastBeat * 60 / bpm)) < .012);
});

test('fractional tempo stays within 15ms after five minutes', () => {
  const analysis = analyze(clicks(128.5, 300));
  const index = Math.floor((299 - .75) * 128.5 / 60);
  assert.ok(Math.abs(analysis.firstBeat + index * 60 / analysis.bpm - (.75 + index * 60 / 128.5)) < .015);
});
test('a song starting with a beat at zero retains its opening note', () => {
  const analysis = analyze(clicks(120, 32, 0));
  assert.ok(analysis.firstBeat < .008);
  assert.ok(createPersonalChart(analysis, { bpm: 120, firstBeat: 0 })[0].time < .008);
});
test('opposite-phase stereo retains beat features', () => {
  const { samples, sampleRate } = clicks();
  const result = analyzeFeatures(extractFeatures([samples, samples.map(value => -value)], sampleRate));
  assert.ok(Math.abs(result.bpm - 120) < .03); assert.ok(result.onsets.length > 50);
});
test('silence is rejected rather than generating a fictitious chart', () => {
  assert.throws(() => analyzeFeatures(extractFeatures([new Float32Array(12000 * 15)], 12000)), /박자/);
});
test('inconsistent later tempo is flagged for manual review', () => {
  const fixture = clicks(120, 60); fixture.samples.fill(0, 12000 * 30);
  for (let time = 30.75; time < 59; time += 60 / 90) for (let i = 0; i < 660; i++) fixture.samples[Math.floor(time * 12000) + i] += .8 * Math.cos(i / 12000 * 2 * Math.PI * 180) * Math.exp(-i / 12000 * 60);
  assert.equal(analyze(fixture).unstable, true);
});
test('BPM and first beat change actual judgment times and record revision', () => {
  const analysis = analyze(clicks());
  const base = { bpm: 120, firstBeat: .75 }, shifted = { bpm: 120, firstBeat: .78 };
  const a = createPersonalChart(analysis, base), b = createPersonalChart(analysis, shifted);
  assert.ok(b.length === a.length || b.length === a.length - 1); // The final attack may move beyond the playable end.
  assert.ok(Math.abs(b[10].time - a[10].time - .03) < 1e-8);
  const slower = createPersonalChart(analysis, { bpm: 119.7, firstBeat: .75 });
  assert.ok(Math.abs(slower.at(-1).time - a.at(-1).time) > .03);
  assert.notEqual(personalRevision(base), personalRevision(shifted));
});
test('all personal modes complete without impossible chords or duplicate lane notes', () => {
  const analysis = analyze(clicks()), config = { bpm: analysis.bpm, firstBeat: analysis.firstBeat };
  const track = makePersonalTrack({ id: 'personal-fixture', title: 'fixture', buffer: { duration: 32 }, analysis, config });
  for (const keyCount of [4, 6]) for (const difficulty of ['easy', 'normal', 'hard']) {
    const chart = chartFor(track, keyCount, difficulty), session = new Session(difficulty, chart);
    const last = Array(keysFor(keyCount).length).fill(-Infinity);
    for (const note of chart) { assert.ok(note.time - last[note.lane] >= .18); last[note.lane] = note.time; session.hit(note.lane, note.time); }
    session.finish(33);
    assert.equal(session.score, 1000000); assert.equal(session.fullCombo, true); assert.equal(session.counts.miss, 0);
  }
  assert.ok(track.charts[4].easy.length < track.charts[4].normal.length);
});
test('invalid calibration and unsafe or unsupported audio limits are rejected', () => {
  assert.throws(() => validateFile({ size: 0 })); assert.throws(() => validateFile({ size: FILE_LIMIT + 1 }));
  assert.throws(() => validateAudio(11, 2)); assert.throws(() => validateAudio(301, 2)); assert.throws(() => validateAudio(30, 6));
  for (const config of [{ bpm: NaN, firstBeat: 0 }, { bpm: 50, firstBeat: 0 }, { bpm: 120, firstBeat: -1 }, { bpm: 120, firstBeat: 29 }]) assert.throws(() => validateCalibration(config, 30));
  validateFile({ size: FILE_LIMIT }); validateAudio(300, 2); validateCalibration({ bpm: 240, firstBeat: 28 }, 30);
});

test('worker receives copied PCM and cancellation ignores queued completion', async () => {
  const OriginalWorker = globalThis.Worker, channel = new Float32Array([.2, .4, -.2]);
  const buffer = { numberOfChannels: 1, sampleRate: 12000, getChannelData: () => channel };
  let worker, progress = 0;
  globalThis.Worker = class {
    constructor() { worker = this; }
    postMessage(data, transfers) { assert.notEqual(data.channels[0], channel); assert.deepEqual(data.channels[0], channel); assert.equal(transfers[0], data.channels[0].buffer); }
    terminate() { this.stopped = true; }
  };
  try {
    const controller = new AbortController();
    const pending = analyzeAudio(buffer, { signal: controller.signal, onProgress: () => progress++ });
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
    worker.onmessage({ data: { stage: 'beats' } }); worker.onmessage({ data: { result: { bpm: 120 } } });
    assert.equal(progress, 0); assert.equal(worker.stopped, true); assert.equal(channel.length, 3);
  } finally { globalThis.Worker = OriginalWorker; }
});
test('worker setup failure terminates its job and allows retry', async () => {
  const OriginalWorker = globalThis.Worker;
  let stopped = 0;
  globalThis.Worker = class { postMessage() { throw new Error('transfer failed'); } terminate() { stopped++; } };
  try {
    await assert.rejects(analyzeAudio({ numberOfChannels: 1, sampleRate: 12000, getChannelData: () => new Float32Array(3) }), /준비/);
    assert.equal(stopped, 1);
  } finally { globalThis.Worker = OriginalWorker; }
});
test('test excerpts inspect start, middle and end using absolute music times', () => {
  const track = { duration: 180, beatOffset: 2 };
  assert.deepEqual(personalTestRange(track), { from: 1.25, to: 11.25, position: 'start' });
  assert.deepEqual(personalTestRange(track, 'middle'), { from: 85, to: 95, position: 'middle' });
  assert.deepEqual(personalTestRange(track, 'end'), { from: 170, to: 180, position: 'end' });
  assert.deepEqual(personalTestRange({ duration: 20, beatOffset: 18 }, 'start'), { from: 17.25, to: 20, position: 'start' });
});
