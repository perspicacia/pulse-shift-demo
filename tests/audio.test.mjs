import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioEngine } from '../src/audio.js';

test('first user play requests worker synthesis and subsequent plays reuse the buffer', async () => {
  const originalWindow = globalThis.window, originalWorker = globalThis.Worker;
  let requests = 0;
  class Context {
    resume() { return Promise.resolve(); }
    createGain() { return { gain: {}, connect() {} }; }
    createBuffer(channels, frames, rate) { return { channels, frames, rate, copyToChannel() {} }; }
  }
  class Worker {
    postMessage(message) {
      assert.equal(message.type, 'render'); requests++;
      queueMicrotask(() => this.onmessage({ data: { left: new Float32Array(100), right: new Float32Array(100), sampleRate: 44100 } }));
    }
    terminate() {}
  }
  globalThis.window = { AudioContext: Context };
  globalThis.Worker = Worker;
  try {
    const audio = new AudioEngine();
    const buffer = await audio.init();
    assert.equal(buffer.channels, 2);
    assert.equal(buffer.rate, 44100);
    assert.equal(await audio.init(), buffer);
    assert.equal(requests, 1);
  } finally { globalThis.window = originalWindow; globalThis.Worker = originalWorker; }
});

test('bundled lobby audio decodes once, retries failed loads, and stays separate from selected music', async () => {
  const originalWindow = globalThis.window, originalFetch = globalThis.fetch, originalWorker = globalThis.Worker;
  let fetches = 0, decodes = 0, fail = true;
  const context = feedbackContext(), loop = { duration: 30 };
  context.decodeAudioData = async () => { decodes++; return loop; };
  globalThis.window = { AudioContext: class { constructor() { return context; } } };
  globalThis.Worker = class { constructor() { throw new Error('Lobby must not wait for live synthesis'); } };
  globalThis.fetch = async url => {
    assert.ok(url.pathname.endsWith('/assets/music/neon-halo.wav')); fetches++;
    return { ok: !fail, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  try {
    const audio = new AudioEngine(), song = { duration: 67 };
    audio.buffer = song; audio.originalBuffer = song;
    await assert.rejects(audio.init('neon-halo'), /대기 음악/);
    assert.equal(audio.musicReady.has('neon-halo'), false);
    fail = false;
    const result = await Promise.all([audio.init('neon-halo'), audio.init('neon-halo')]);
    assert.deepEqual(result, [loop, loop]); assert.equal(await audio.init('neon-halo'), loop);
    assert.equal(fetches, 2); assert.equal(decodes, 1);
    assert.equal(audio.buffer, song); assert.equal(audio.originalBuffer, song);
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; globalThis.Worker = originalWorker; }
});

test('explicit music buffers determine which song plays and never overwrite the original cache', () => {
  const audio = new AudioEngine(), original = { duration: 67 }, alternate = { duration: 12 };
  const sources = [];
  audio.originalBuffer = original;
  audio.master = {};
  audio.context = { currentTime: 2, createBufferSource() {
    const source = { connect() {}, start(time, offset) { this.scheduled = { time, offset }; }, stop() {}, disconnect() {} };
    sources.push(source); return source;
  } };
  audio.play({ buffer: alternate, countdown: 3 });
  assert.equal(sources[0].buffer, alternate);
  assert.equal(sources[0].scheduled.time, 5.12);
  audio.play({ buffer: original });
  assert.equal(sources[1].buffer, original);
  assert.equal(audio.originalBuffer, original);
});

test('audible output timestamps map an input event onto the music timeline', () => {
  const audio = new AudioEngine(), perf = performance.now();
  audio.context = { currentTime: 10.05, getOutputTimestamp: () => ({ contextTime: 10, performanceTime: perf }) };
  audio.source = {};
  audio.startTime = 3;
  assert.ok(Math.abs(audio.time(perf + 20) - 7.02) < 1e-9);
});

test('stale output timestamps after a pause cannot jump song time by the paused wall-clock duration', async () => {
  const audio = new AudioEngine();
  audio.source = {};
  audio.startTime = 3;
  audio.context = {
    currentTime: 10,
    outputLatency: 0.05,
    getOutputTimestamp: () => ({ contextTime: 9.9, performanceTime: performance.now() - 5000 }),
    suspend() { this.currentTime = 10.01; return Promise.resolve(); },
    resume() { return Promise.resolve(); },
  };
  assert.ok(Math.abs(audio.time() - 6.95) < 1e-9);
  await audio.pause();
  const frozen = audio.time();
  assert.ok(Math.abs(frozen - 7.01) < 1e-9);
  assert.equal(audio.time(performance.now() + 5000), frozen);
  await audio.resume();
  assert.ok(audio.time() < 7.1);
});

test('fallback output clocks preserve delayed keyboard and pointer event times', () => {
  for (const timestamp of [undefined, () => ({contextTime:0,performanceTime:0}), () => ({contextTime:5,performanceTime:performance.now()-1000})]) {
    const audio=new AudioEngine();audio.source={};audio.startTime=3;
    audio.context={currentTime:10.05,outputLatency:.03,baseLatency:.005,getOutputTimestamp:timestamp};
    const now=performance.now(),atEvent=audio.time(now-80),atHandler=audio.time(now);
    assert.ok(Math.abs(atHandler-atEvent-.08)<.001,'80ms event age is preserved when timestamps are absent, zero, or stale');
    assert.ok(Math.abs(audio.time()-7.02)<1e-9);
  }
});
function feedbackContext() {
  const nodes = [];
  const param = () => ({ value: 1, changes: [], cancelScheduledValues(time) { this.changes.push(['cancel', time]); }, setTargetAtTime(value, time) { this.value = value; this.changes.push(['target', value, time]); }, setValueAtTime(value, time) { this.changes.push(['set', value, time]); }, exponentialRampToValueAtTime(value, time) { this.changes.push(['exponential', value, time]); }, linearRampToValueAtTime(value, time) { this.changes.push(['linear', value, time]); } });
  const node = () => { const value = { gain: param(), frequency: param(), connect(target) { this.target = target; return target; }, disconnect() { this.disconnected = true; }, start(time) { this.started = time; }, stop() { this.stopped = true; } }; nodes.push(value); return value; };
  return {
    currentTime: 2, sampleRate: 48000, state: 'running', destination: {}, nodes,
    resume: async () => {}, createGain: node, createBufferSource: node,
    createOscillator() { throw new Error('Feedback must not introduce musical pitches'); },
    createBuffer(channels, frames, sampleRate) { const data = Array.from({ length: channels }, () => new Float32Array(frames)); return { duration: frames / sampleRate, sampleRate, numberOfChannels: channels, getChannelData: channel => data[channel || 0] }; },
    decodeAudioData: async () => ({ duration: 0.46 }),
  };
}

test('lobby loops on its own bus, fades before song startup, and cannot change the song clock or selected buffer', async () => {
  const originalWindow = globalThis.window, context = feedbackContext();
  globalThis.window = { AudioContext: class { constructor() { return context; } } };
  try {
    const audio = new AudioEngine(), song = { duration: 80 }, loop = { duration: 30 };
    await audio.initContext(); audio.buffer = song; audio.originalBuffer = song;
    audio.setLobbyVolume(0.2); audio.setVolume(0.65);
    assert.equal(audio.playLobby(loop), true);
    const source = audio.lobbySource, gain = audio.lobbyGain;
    assert.equal(source.loop, true); assert.equal(source.loopEnd, 30);
    assert.equal(source.target.target, audio.lobbyBus);
    assert.equal(audio.buffer, song); assert.equal(audio.originalBuffer, song); assert.equal(audio.time(), 0);
    assert.equal(audio.musicBus.gain.value, 0.65); assert.equal(audio.lobbyBus.gain.value, 0.2);
    audio.stopFeedback(); assert.equal(audio.lobbySource, source);
    audio.stop(); assert.equal(audio.lobbySource, source);
    audio.play({ buffer: song, countdown: 3 });
    assert.equal(audio.lobbySource, null); assert.ok(source.stopped);
    assert.ok(gain.gain.changes.some(([type, value, time]) => type === 'linear' && value === 0 && time === 2.08));
    assert.equal(audio.startTime, 5.12); assert.equal(audio.playLobby(loop), false);
    source.onended(); assert.ok(source.disconnected && gain.disconnected); assert.equal(audio.lobbyFades.size, 0);
    audio.stop(); context.state = 'suspended'; assert.equal(audio.playLobby(loop), false);
    context.state = 'running'; audio.setLobbyVolume(0); assert.equal(audio.playLobby(loop), false);
    audio.setLobbyVolume(0.3); audio.playLobby(loop); const first = audio.lobbySource;
    audio.stopLobby(); audio.playLobby(loop); const second = audio.lobbySource;
    assert.ok(first.disconnected); assert.equal(audio.lobbyFades.size, 0);
    first.onended(); assert.equal(audio.lobbySource, second);
    audio.stopLobby(); second.onended();
  } finally { globalThis.window = originalWindow; }
});

test('selected preview loops separately, reuses its PCM, and yields to game playback without altering its clock', async () => {
  const originalWindow = globalThis.window, context = feedbackContext();
  globalThis.window = { AudioContext: class { constructor() { return context; } } };
  try {
    const audio = new AudioEngine(); await audio.initContext();
    const song = context.createBuffer(2, 2000, 100), original = { duration: 80 };
    audio.buffer = original; audio.originalBuffer = original;
    audio.startTime = 123; audio.offset = 7;
    const range = { offset: 4, length: 8 };
    assert.equal(audio.playPreview(song, range), true);
    const first = audio.previewSource, loop = first.buffer;
    assert.equal(first.loop, true); assert.equal(first.loopStart, 0); assert.equal(first.loopEnd, 8);
    assert.equal(first.started, 2.12); assert.equal(first.target.target, audio.musicBus);
    assert.equal(audio.source, null); assert.equal(audio.buffer, original); assert.equal(audio.originalBuffer, original);
    assert.equal(audio.startTime, 123); assert.equal(audio.offset, 7); assert.equal(audio.time(), 0);
    assert.equal(audio.playLobby({ duration: 30 }), false);
    audio.stopPreview(); assert.ok(first.stopped && first.disconnected); assert.equal(audio.previewSource, null);
    audio.playPreview(song, range); const second = audio.previewSource;
    assert.equal(second.buffer, loop, 'Reopening the menu reuses the same prepared loop');
    first.onended(); assert.equal(audio.previewSource, second);
    audio.play({ buffer: original, countdown: 3 });
    assert.ok(second.stopped && second.disconnected); assert.equal(audio.previewSource, null);
    assert.equal(audio.source.buffer, original); assert.equal(audio.startTime, 5.12); assert.equal(audio.offset, 0);
    assert.equal(audio.playPreview(song, range), false, 'Cannot start a menu preview over the game source');
    audio.stop(); context.state = 'suspended'; assert.equal(audio.playPreview(song, range), false);
  } finally { globalThis.window = originalWindow; }
});

test('music, hits and combo cues have independent volumes; stop cleans up all feedback', async () => {
  const original = globalThis.window, context = feedbackContext();
  globalThis.window = { AudioContext: class { constructor() { return context; } } };
  try {
    const audio = new AudioEngine(); await audio.prepareFeedback();
    audio.setVolume(0.3); audio.setEffectsVolume(0); audio.setComboVolume(0.8);
    audio.hit(0); assert.equal(audio.feedbackSources.size, 0);
    const changes = audio.musicBus.gain.changes.length;
    audio.celebrate(10);
    const cue = audio.comboSource;
    assert.equal(cue.target.target, audio.comboBus);
    assert.equal(cue.buffer.duration, 0.3);
    assert.equal(audio.musicBus.gain.changes.length, changes, 'No music duck or restart');
    audio.celebrate(50); assert.ok(cue.stopped); assert.equal(audio.comboSource.buffer.duration, 0.48);
    audio.stop(); assert.equal(audio.feedbackSources.size, 0); assert.equal(audio.comboSource, null);
    audio.setComboVolume(0); audio.celebrate(100); assert.equal(audio.feedbackSources.size, 0);
    audio.setEffectsVolume(0.6); audio.hit(1, 'miss'); assert.equal(audio.feedbackSources.size, 0);
    audio.hit(1, 'perfect'); assert.equal(audio.feedbackSources.size, 1);
    audio.stopFeedback(); assert.equal(audio.feedbackSources.size, 0);
  } finally { globalThis.window = original; }
});

test('combo synthesis is cached, requires no asset fetch, and preserves selected music', async () => {
  const originalWindow = globalThis.window, originalFetch = globalThis.fetch, context = feedbackContext();
  globalThis.window = { AudioContext: class { constructor() { return context; } } };
  globalThis.fetch = async () => { throw Error('Feedback must work without network assets'); };
  try {
    const audio = new AudioEngine(), selected = { duration: 120 }, original = { duration: 67 };
    audio.buffer = selected; audio.originalBuffer = original;
    await Promise.all([audio.prepareFeedback(), audio.prepareFeedback()]);
    const buffers = { ...audio.comboBuffers }; await audio.prepareFeedback();
    assert.deepEqual(Object.keys(buffers).sort(), ['light', 'major']);
    assert.equal(audio.comboBuffers.light, buffers.light); assert.equal(audio.comboBuffers.major, buffers.major);
    assert.equal(audio.buffer, selected); assert.equal(audio.originalBuffer, original);
  } finally { globalThis.window = originalWindow; globalThis.fetch = originalFetch; }
});

test('ordinary judgments play only taps; combo cues leave the music clock and source unchanged', async () => {
  const originalWindow = globalThis.window, context = feedbackContext();
  globalThis.window = { AudioContext: class { constructor() { return context; } } };
  try {
    const audio = new AudioEngine(); await audio.prepareFeedback();
    audio.source = { stop() {}, disconnect() {} }; audio.startTime = 1;
    const songTime = audio.time(), musicSource = audio.source;
    for (const kind of ['perfect', 'great', 'good']) for (let i = 0; i < 4; i++) audio.hit(i, kind);
    assert.equal(audio.comboSource, null);
    audio.celebrate(100); assert.equal(audio.comboSource.buffer, audio.comboBuffers.major);
    assert.equal(audio.comboSource.started, 2);
    assert.equal(audio.source, musicSource); assert.equal(audio.time(), songTime);
    audio.stop(); assert.equal(audio.comboSource, null); assert.equal(audio.nextComboAt, 0);
  } finally { globalThis.window = originalWindow; }
});

test('combo mute cancels only the cue; a new preview replaces the active preview', async () => {
  const originalWindow = globalThis.window, context = feedbackContext();
  globalThis.window = { AudioContext: class { constructor() { return context; } } };
  try {
    const audio = new AudioEngine(); await audio.prepareFeedback(); audio.hit(0);
    const tap = [...audio.feedbackSources][0];
    assert.equal(audio.playCombo('light', { preview: true }), true); const first = audio.comboSource;
    assert.equal(audio.playCombo('major', { preview: true }), true); assert.ok(first.stopped);
    const second = audio.comboSource; audio.setComboVolume(0);
    assert.ok(second.stopped && second.disconnected); assert.equal(audio.comboSource, null);
    assert.equal(audio.feedbackSources.size, 1); assert.ok(!tap.stopped);
    assert.equal(audio.playCombo('major', { preview: true }), false);
    audio.setComboVolume(0.8); context.state = 'suspended';
    assert.equal(audio.playCombo('major', { preview: true }), false);
    assert.equal(audio.playCombo('toString'), false);
  } finally { globalThis.window = originalWindow; }
});
test('quiet music gets gentler percussion without changing song time or muting standalone feedback', () => {
  const audio = new AudioEngine(), rate = 48000;
  const channel = new Float32Array(rate * 2);
  channel.fill(0.02, 0, rate); channel.fill(0.2, rate);
  audio.source = {};
  audio.context = { currentTime: 0.5 };
  audio.buffer = { sampleRate: rate };
  audio.musicChannels = [channel];
  const time = audio.time(), quiet = audio.hitMixGain();
  assert.equal(audio.time(), time);
  audio.context.currentTime = 1.5;
  const loud = audio.hitMixGain();
  assert.ok(loud > quiet * 2);
  assert.ok(loud <= 0.075 && quiet > 0);
  audio.source = null;
  assert.ok(audio.hitMixGain() > 0);
  audio.source = {}; audio.volume = 0;
  assert.ok(audio.hitMixGain() > 0);
});
test('concurrent original songs render once each, keep distinct buffers, and recover per-track failures', async () => {
  const originalWindow = globalThis.window, originalWorker = globalThis.Worker;
  const requests = [];
  let failTidal = true;
  class Context {
    resume() { return Promise.resolve(); }
    createGain() { return { gain: {}, connect() {} }; }
    createBuffer(channels, frames, rate) { return { channels, frames, rate, copyToChannel() {} }; }
  }
  class Worker {
    postMessage({ trackId }) {
      requests.push(trackId);
      queueMicrotask(() => {
        if (trackId === 'tidal-circuit' && failTidal) { failTidal = false; this.onmessage({ data: { error: 'render failed' } }); return; }
        const frames = trackId === 'afterglow' ? 100 : trackId === 'astral-veil' ? 300 : 200;
        this.onmessage({ data: { left: new Float32Array(frames), right: new Float32Array(frames), sampleRate: 44100 } });
      });
    }
    terminate() {}
  }
  globalThis.window = { AudioContext: Context }; globalThis.Worker = Worker;
  try {
    const audio = new AudioEngine();
    const results = await Promise.allSettled([audio.init('afterglow'), audio.init('tidal-circuit'), audio.init('tidal-circuit'), audio.init('astral-veil'), audio.init('astral-veil')]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected'); assert.equal(results[2].status, 'rejected');
    assert.equal(results[3].status, 'fulfilled'); assert.equal(results[4].value, results[3].value);
    const astral = results[3].value;
    assert.equal(astral.frames, 300);
    assert.equal(await audio.init('astral-veil'), astral);
    const tidal = await audio.init('tidal-circuit'), afterglow = results[0].value;
    assert.equal(tidal.frames, 200); assert.equal(afterglow.frames, 100);
    assert.equal(await audio.init('tidal-circuit'), tidal);
    assert.equal(await audio.init('afterglow'), afterglow);
    assert.equal(audio.originalBuffer, afterglow);
    assert.deepEqual(requests, ['afterglow', 'tidal-circuit', 'astral-veil', 'tidal-circuit']);
  } finally { globalThis.window = originalWindow; globalThis.Worker = originalWorker; }
});
