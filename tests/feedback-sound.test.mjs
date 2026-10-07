import test from 'node:test';
import assert from 'node:assert/strict';
import { createPercussion, createComboCue, localMusicLevel } from '../src/feedback-sound.js';

test('percussion is short, bounded, and starts and ends at silence across device sample rates', () => {
  for (const sampleRate of [22050, 44100, 48000, 96000]) {
    for (const kind of ['hit', 'reward']) {
      const data = createPercussion(sampleRate, kind);
      assert.ok(data.length / sampleRate < (kind === 'hit' ? 0.04 : 0.1));
      assert.equal(Math.abs(data[0]), 0);
      assert.equal(Math.abs(data.at(-1)), 0);
      assert.ok(data.every(value => Number.isFinite(value) && Math.abs(value) <= 0.751));
      assert.ok(data.some(value => Math.abs(value) > 0.5));
      const tail = data.slice(-Math.floor(sampleRate * 0.004));
      assert.ok(tail.every(value => Math.abs(value) < 0.08));
    }
  }
});

test('music level follows quiet and loud passages, keeps stereo energy, and handles track edges', () => {
  const sampleRate = 48000, channel = new Float32Array(sampleRate * 2);
  channel.fill(0.02, 0, sampleRate); channel.fill(0.2, sampleRate);
  const inverse = channel.map(value => -value);
  const quiet = localMusicLevel([channel], sampleRate, 0.5);
  const loud = localMusicLevel([channel], sampleRate, 1.5);
  assert.ok(loud > quiet * 9.9);
  assert.ok(Math.abs(localMusicLevel([channel, inverse], sampleRate, 1.5) - loud) < 1e-9);
  assert.ok(Number.isFinite(localMusicLevel([channel], sampleRate, -1)));
  assert.equal(localMusicLevel([channel], sampleRate, 3), 0);
  assert.equal(localMusicLevel([], sampleRate, 0), null);
});
test('sustained musical tones cannot fall between sparse energy samples and become falsely quiet', () => {
  const sampleRate = 48000;
  for (const frequency of [400, 800, 1600, 3200]) {
    const channel = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.2);
    const level = localMusicLevel([channel], sampleRate, 0.5);
    assert.ok(level > 0.13 && level < 0.15);
  }
});

test('electronic combo cues stay short, bounded and click-free across device sample rates', () => {
  for (const rate of [22050, 44100, 48000, 96000]) for (const kind of ['light', 'major']) {
    const data = createComboCue(rate, kind), duration = kind === 'major' ? 0.48 : 0.30;
    assert.ok(Math.abs(data.length / rate - duration) < 1 / rate);
    assert.equal(Math.abs(data[0]), 0); assert.equal(Math.abs(data.at(-1)), 0);
    assert.ok(data.every(x => Number.isFinite(x) && Math.abs(x) <= 0.501));
    assert.ok(data.some(x => Math.abs(x) > 0.49));
    assert.ok(data.slice(-Math.floor(rate * 0.004)).every(x => Math.abs(x) < 0.005));
  }
});
