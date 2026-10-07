import test from 'node:test';
import assert from 'node:assert/strict';
import { SelectedPreview, previewRange, previewSamples } from '../src/selected-preview.js';
import { LobbyMusic } from '../src/lobby-music.js';
import { BUILTIN_TRACKS } from '../src/tracks.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const [afterglow, tidal, astral] = BUILTIN_TRACKS;
function fixture() {
  let allowed = true;
  const pending = [], states = [], errors = [];
  const audio = {
    previewSource: null, starts: [],
    init(id) { return new Promise((resolve, reject) => pending.push({ id, resolve, reject })); },
    playPreview(buffer, range) { this.previewSource = buffer; this.starts.push({ buffer, range }); return true; },
    stopPreview() { this.previewSource = null; },
  };
  const preview = new SelectedPreview(audio, { canPlay: () => allowed, onState: status => states.push(status), onError: error => errors.push(error) });
  return { preview, audio, pending, states, errors, allow(value) { allowed = value; preview.sync(); } };
}

test('selected menu music waits for trusted unlock and keeps its original authored excerpt', async () => {
  const f = fixture();
  f.preview.select(astral);
  assert.equal(f.pending.length, 0); assert.equal(f.preview.status, 'idle');
  f.preview.unlock();
  assert.equal(f.pending[0].id, 'astral-veil');
  f.pending[0].resolve({ duration: astral.duration }); await flush();
  assert.equal(f.preview.status, 'playing');
  assert.equal(f.audio.starts[0].range.offset, astral.previewBeat * 60 / astral.bpm);
  assert.equal(f.audio.starts[0].range.length, 32 * 60 / astral.bpm);
  f.preview.sync(); f.preview.sync();
  assert.equal(f.pending.length, 1); assert.equal(f.audio.starts.length, 1);
  const short = previewRange({ bpm: 120, previewBeat: 20, duration: 5 });
  assert.deepEqual(short, { offset: 0, length: 5 });
});

test('rapid song choices only start the final song and stale failures cannot replace it', async () => {
  const f = fixture(); f.preview.unlock();
  f.preview.select(afterglow); f.preview.select(tidal); f.preview.select(astral);
  f.preview.sync();
  assert.deepEqual(f.pending.map(request => request.id), ['afterglow', 'tidal-circuit', 'astral-veil']);
  const latest = { duration: astral.duration };
  f.pending[2].resolve(latest); await flush();
  f.pending[0].resolve({ duration: afterglow.duration }); f.pending[1].reject(Error('stale render failure')); await flush();
  assert.equal(f.audio.previewSource, latest); assert.equal(f.audio.starts.length, 1);
  assert.equal(f.errors.length, 0); assert.equal(f.preview.status, 'playing');
  f.preview.select(astral);
  assert.equal(f.audio.starts.length, 1, 'Clicking an already playing center cover keeps its position');
});

test('hidden tabs, dialogs, mute and game entry cancel a late start and resume the selected song', async () => {
  for (const reason of ['hidden', 'settings', 'help', 'mute', 'game']) {
    const f = fixture(); f.preview.unlock(); f.preview.select(tidal);
    f.allow(false); f.pending[0].resolve({ duration: tidal.duration }); await flush();
    assert.equal(f.audio.starts.length, 0, reason); assert.equal(f.preview.status, 'paused');
    f.allow(true);
    f.pending[1].resolve({ duration: tidal.duration }); await flush();
    assert.equal(f.audio.starts.length, 1, reason); assert.equal(f.preview.status, 'playing');
    f.allow(false); assert.equal(f.audio.previewSource, null, reason);
  }
});

test('manual stop survives menu and tab restoration; choosing a cover explicitly starts it again', async () => {
  const f = fixture(); f.preview.unlock(); f.preview.select(afterglow);
  f.preview.toggle();
  f.pending[0].resolve({ duration: afterglow.duration }); await flush();
  assert.equal(f.audio.starts.length, 0); assert.equal(f.preview.status, 'off');
  f.allow(false); f.allow(true);
  assert.equal(f.pending.length, 1); assert.equal(f.preview.requested, false);
  f.preview.select(afterglow);
  f.pending[1].resolve({ duration: afterglow.duration }); await flush();
  assert.equal(f.preview.status, 'playing');
  f.preview.toggle(); f.allow(false); f.allow(true);
  assert.equal(f.audio.previewSource, null); assert.equal(f.preview.status, 'off');
  f.preview.toggle(); f.pending[2].resolve({ duration: afterglow.duration }); await flush();
  assert.equal(f.audio.starts.length, 2);
});

test('failed selected music stays silent until an explicit retry and never restores the default lobby', async () => {
  const f = fixture();
  const lobbyStarts = [];
  f.audio.stopLobby = () => { f.audio.lobbySource = null; };
  f.audio.playLobby = buffer => { f.audio.lobbySource = buffer; lobbyStarts.push(buffer); return true; };
  const lobby = new LobbyMusic(f.audio, { canPlay: () => !f.preview.track });
  f.preview.onState = () => lobby.sync();
  // Also exercises an already loading NEON HALO request losing to a selection.
  f.preview.unlock(); lobby.unlock(); f.preview.select(astral);
  f.pending[0].resolve({ duration: 30 }); f.pending[1].reject(Error('render failed')); await flush();
  assert.equal(f.errors.length, 1); assert.equal(f.preview.status, 'error');
  assert.equal(lobbyStarts.length, 0); assert.equal(f.audio.previewSource, null);
  f.preview.sync(); assert.equal(f.pending.length, 2);
  f.preview.toggle(); f.pending[2].resolve({ duration: astral.duration }); await flush();
  assert.equal(f.preview.status, 'playing'); assert.equal(lobbyStarts.length, 0);
  f.preview.toggle(); assert.equal(lobbyStarts.length, 0);
  const mutedLobby = new LobbyMusic(f.audio, { enabled: false, canPlay: () => !f.preview.track });
  mutedLobby.unlock(); f.preview.select(tidal);
  f.pending[3].resolve({ duration: tidal.duration }); await flush();
  assert.equal(f.preview.status, 'playing'); assert.equal(mutedLobby.enabled, false);
});

test('loop PCM preserves the downbeat and beat duration while smoothing the seam without changing the song', () => {
  const rate = 1000;
  const channel = Float32Array.from({ length: 10000 }, (_, i) => Math.sin(i * 0.01));
  const original = channel.slice();
  const loop = previewSamples(channel, rate, { offset: 2, length: 4 });
  assert.equal(loop.length, 4000);
  assert.deepEqual(loop.slice(0, 100), channel.slice(2000, 2100));
  assert.ok(Math.abs(loop.at(-1) - loop[0]) < 0.014);
  assert.ok(Math.abs(channel[5999] - channel[2000]) > 0.5, 'The unprocessed excerpt has a noticeable seam');
  assert.deepEqual(channel, original);
  assert.ok(loop.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
  const firstBeat = previewSamples(channel, rate, { offset: 0, length: 1 });
  assert.deepEqual(firstBeat, channel.slice(0, rate));
});
