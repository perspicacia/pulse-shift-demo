import test from 'node:test';
import assert from 'node:assert/strict';
import { LobbyMusic } from '../src/lobby-music.js';
import { LOBBY_DURATION, synthesizeLobby } from '../src/synth-lobby.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(enabled = true) {
  let allowed = true;
  const pending = [], statuses = [], errors = [];
  const audio = {
    lobbySource: null, starts: [],
    init(id) { assert.equal(id, 'neon-halo'); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    playLobby(buffer) { this.lobbySource = buffer; this.starts.push(buffer); return true; },
    stopLobby() { this.lobbySource = null; },
  };
  const lobby = new LobbyMusic(audio, { enabled, canPlay: () => allowed, onState: state => statuses.push(state), onError: error => errors.push(error) });
  return { audio, lobby, pending, statuses, errors, allow(value) { allowed = value; } };
}

test('lobby waits for user input and never starts a late render over a song, hidden tab, or mute', async () => {
  for (const blockedBy of ['song', 'hidden', 'mute']) {
    const f = fixture();
    f.lobby.sync(); assert.equal(f.pending.length, 0); assert.equal(f.statuses.at(-1), 'idle');
    f.lobby.unlock(); assert.equal(f.pending.length, 1);
    if (blockedBy === 'mute') f.lobby.toggle(); else { f.allow(false); f.lobby.sync(); }
    f.pending[0].resolve({ duration: 30 }); await flush();
    assert.equal(f.audio.starts.length, 0); assert.equal(f.audio.lobbySource, null);
    if (blockedBy === 'mute') f.lobby.toggle(); else { f.allow(true); f.lobby.sync(); }
    f.pending[1].resolve({ duration: 30 }); await flush();
    assert.equal(f.audio.starts.length, 1); assert.equal(f.statuses.at(-1), 'playing');
    f.lobby.sync(); assert.equal(f.pending.length, 2); assert.equal(f.audio.starts.length, 1);
  }
});

test('rapid changes leave only the final lobby request active and muted preference survives unlock', async () => {
  const f = fixture(false);
  f.lobby.unlock(); assert.equal(f.pending.length, 0); assert.equal(f.statuses.at(-1), 'off');
  f.lobby.toggle(); f.allow(false); f.lobby.sync(); f.allow(true); f.lobby.sync();
  f.pending[1].resolve('latest'); await flush();
  f.pending[0].resolve('stale'); await flush();
  assert.deepEqual(f.audio.starts, ['latest']);
  f.lobby.toggle(); assert.equal(f.audio.lobbySource, null); assert.equal(f.statuses.at(-1), 'off');
});

test('failed lobby loading can be retried; stale failures do not interrupt a newer choice', async () => {
  const f = fixture(); f.lobby.unlock();
  f.pending[0].reject(new Error('render failed')); await flush();
  assert.equal(f.statuses.at(-1), 'error'); assert.equal(f.errors.length, 1);
  f.lobby.toggle(); assert.equal(f.lobby.enabled, true);
  f.allow(false); f.lobby.sync(); f.allow(true); f.lobby.sync();
  f.pending[1].reject(new Error('old failure')); await flush();
  assert.equal(f.errors.length, 1);
  f.pending[2].resolve('recovered'); await flush();
  assert.equal(f.statuses.at(-1), 'playing'); assert.deepEqual(f.audio.starts, ['recovered']);
});

test('original lobby loop has bounded audible stereo PCM and a smooth wrap boundary', () => {
  const rate = 11025, { left, right, sampleRate } = synthesizeLobby(rate);
  assert.equal(sampleRate, rate); assert.equal(left.length, Math.round(LOBBY_DURATION * rate)); assert.equal(right.length, left.length);
  let power = 0, difference = 0, peak = 0;
  for (let i = 0; i < left.length; i++) {
    assert.ok(Number.isFinite(left[i]) && Number.isFinite(right[i]));
    power += left[i] ** 2 + right[i] ** 2; difference += (left[i] - right[i]) ** 2;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  assert.ok(peak <= 0.781 && peak > 0.4);
  assert.ok(Math.sqrt(power / (left.length * 2)) > 0.04);
  assert.ok(difference / left.length > 0.0001);
  for (const channel of [left, right]) assert.ok(Math.abs(channel[0] - channel.at(-1)) < 0.05, 'loop seam must not introduce a click');
});
