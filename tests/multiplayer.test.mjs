import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerClient, estimateServerClock } from '../src/multiplayer.js';

test('clock sync uses the least delayed midpoint sample, rejects unstable high latency and maps common server start to local performance', () => {
  const sync = estimateServerClock([{ sent: 100, received: 200, serverTime: 1000150 }, { sent: 210, received: 220, serverTime: 1000215 }, { sent: 230, received: 270, serverTime: 1000250 }]);
  assert.equal(sync.offset, 1000000); assert.equal(sync.rtt, 10); assert.equal(1004000 - sync.offset, 4000);
  assert.throws(() => estimateServerClock([]), /시각/);
  assert.throws(() => estimateServerClock(Array.from({ length: 3 }, (_, index) => ({ sent: index * 500, received: index * 500 + 450, serverTime: 9999 }))), /지연/);
});
test('client accepts only current room streams, resets round sequence, and ignores delayed actions after leaving', async () => {
  let pendingResolve; const calls = [], sources = [], states = [];
  class Source { constructor(url) { this.url = url; this.handlers = {}; sources.push(this); } addEventListener(type, callback) { this.handlers[type] = callback; } close() { this.closed = true; } }
  const fetcher = async (url, options) => { calls.push({ url, options }); if (url.endsWith('/rooms')) return { ok: true, json: async () => ({ token: 'token', playerId: 'me', room: { code: 'ABC123', phase: 'waiting', round: null } }) }; if (JSON.parse(options.body).type === 'config') return new Promise(resolve => { pendingResolve = () => resolve({ ok: true, json: async () => ({ room: { code: 'ABC123', round: { id: 'old' } } }) }); }); return { ok: true, json: async () => ({ left: true }) }; };
  const client = new MultiplayerClient({ fetcher, EventSourceClass: Source, now: () => 0, onRoom: room => states.push(room), onConnection: () => {} });
  await client.enter('rooms', { nickname: 'x', config: {} }); assert.equal(sources.length, 1); assert.ok(!calls[0].options.headers.Authorization);
  sources[0].handlers.room({ data: JSON.stringify({ code: 'ABC123', round: { id: 'round' }, phase: 'countdown' }) });
  client.sequence = 15; client.accept({ code: 'ABC123', round: { id: 'next' }, revision: 10 }); assert.equal(client.sequence, 0);
  client.accept({ code: 'ABC123', round: { id: 'stale' }, revision: 9 }); assert.equal(client.room.round.id, 'next');
  const pending = client.action({ type: 'config' }); await client.leave(); pendingResolve(); await pending;
  assert.equal(client.room, null); assert.equal(sources[0].closed, true);
  sources[0].handlers.room({ data: JSON.stringify({ code: 'ABC123', round: { id: 'late' } }) }); assert.equal(client.room, null);
  assert.equal(states.at(-1), null);
});
test('stats are throttled and serialize only numeric summary, round and token; final result bypasses interval', async () => {
  let now = 0; const requests = [];
  const client = new MultiplayerClient({ now: () => now, fetcher: async (url, options) => { requests.push({ url, options, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; }, EventSourceClass: class {} });
  client.credentials = { token: 'opaque', playerId: 'me' }; client.room = { round: { id: 'match', startAt: 1000 } }; client.clock = { offset: 1000 };
  const stats = { score: 123, combo: 2, maxCombo: 3, accuracy: 97 };
  await client.sendStats(stats); assert.equal(requests.length, 0);
  now = 300; await client.sendStats(stats); await client.sendStats(stats); assert.equal(requests.length, 1);
  now = 320; await client.sendStats(stats, { finish: true }); assert.equal(requests.length, 2); assert.equal(requests[1].body.type, 'finish');
  assert.deepEqual(Object.keys(requests[0].body).sort(), ['roundId', 'sequence', 'stats', 'type']);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer opaque');
});
test('static hosting reports lack of multiplayer server without altering solo state', async () => {
  const client = new MultiplayerClient({ fetcher: async () => ({ json: async () => { throw new Error('HTML'); } }), EventSourceClass: class {} });
  await assert.rejects(client.enter('rooms', { nickname: 'me', config: {} }), /멀티 서버/); assert.equal(client.room, null); assert.equal(client.credentials, null);
});

test('host config captures the changed song and LEVEL before rendering the previous server state', async () => {
  const { Multiplayer } = await import('../src/multiplayer.js');
  const originalDocument = globalThis.document;
  const selects = { 'multi-track': { value: 'sunset-sip' }, 'multi-difficulty': { value: 'hard' } };
  globalThis.document = { getElementById: id => selects[id] };
  const requests = [], ui = Object.create(Multiplayer.prototype);
  ui.busy = false; ui.client = { credentials: { playerId: 'host' }, room: { hostId: 'host', phase: 'waiting', config: { trackId: 'afterglow', difficulty: 'normal', keyCount: 4 } }, async action(body) { requests.push(body); this.room.config = body.config; } };
  ui.clearError = () => {}; ui.error = message => assert.fail(message);
  ui.render = () => { selects['multi-track'].value = ui.room.config.trackId; selects['multi-difficulty'].value = ui.room.config.difficulty; };
  try {
    await ui.configure();
    assert.deepEqual(requests[0], { type: 'config', config: { trackId: 'sunset-sip', difficulty: 'hard', keyCount: 4 } });
    assert.equal(selects['multi-track'].value, 'sunset-sip'); assert.equal(selects['multi-difficulty'].value, 'hard');
    selects['multi-track'].value = 'mirage-bloom'; selects['multi-difficulty'].value = 'easy';
    await ui.configure();
    assert.deepEqual(requests[1].config, { trackId: 'mirage-bloom', difficulty: 'easy', keyCount: 4 });
    assert.equal(selects['multi-track'].value, 'mirage-bloom'); assert.equal(selects['multi-difficulty'].value, 'easy');
  } finally { globalThis.document = originalDocument; }
});

test('finish waits for the live update and sends the final score, but discards a result when the round changes while waiting', async () => {
  const requests = [], pending = [];
  const client = new MultiplayerClient({ now: () => 500, fetcher: (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Promise(resolve => pending.push(() => resolve({ ok: true, json: async () => ({}) })));
  }, EventSourceClass: class {} });
  client.credentials = { token: 'token', playerId: 'me' }; client.clock = { offset: 1000 }; client.room = { round: { id: 'match', startAt: 1000 } };
  const live = client.sendStats({ score: 10, combo: 1, maxCombo: 1, accuracy: 100 });
  const finish = client.sendStats({ score: 1000000, combo: 100, maxCombo: 100, accuracy: 100 }, { finish: true });
  assert.equal(requests.length, 1); pending.shift()(); await live;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2); assert.equal(requests[1].type, 'finish'); assert.equal(requests[1].stats.score, 1000000); assert.equal(requests[1].roundId, 'match');
  pending.shift()(); await finish;
  client.room = { round: { id: 'old', startAt: 1000 } }; client.lastSend = 0;
  const oldLive = client.sendStats({ score: 5, combo: 0, maxCombo: 0, accuracy: 90 });
  const staleFinish = client.sendStats({ score: 100, combo: 0, maxCombo: 0, accuracy: 90 }, { finish: true });
  client.accept({ round: { id: 'new', startAt: 1000 } }); pending.shift()(); await Promise.all([oldLive, staleFinish]);
  assert.equal(requests.length, 3); assert.equal(requests.at(-1).roundId, 'old'); assert.equal(requests.at(-1).type, 'stats');
});

test('finished players prepare buffer and clock for rematch instead of cancelling the previous READY', async () => {
  const { Multiplayer } = await import('../src/multiplayer.js');
  const originalDocument = globalThis.document;
  globalThis.document = { hidden: false };
  const ui = Object.create(Multiplayer.prototype), requests = [], buffer = {}, track = { id: 'mirage-bloom' };
  let preparations = 0, clockChecks = 0;
  ui.tracks = [track]; ui.busy = false; ui.connection = 'connected'; ui.prepareGeneration = 0;
  ui.client = { credentials: { playerId: 'host' }, room: { phase: 'results', version: 7, config: { trackId: track.id }, players: [{ id: 'host', ready: true }, { id: 'guest', ready: true }] }, async syncClock() { clockChecks++; }, async action(body) { requests.push(body); this.room.phase = 'waiting'; this.room.players[1].ready = false; } };
  ui.callbacks = { onPrepare: async selected => { assert.equal(selected, track); preparations++; return buffer; } };
  ui.clearError = () => {}; ui.render = () => {}; ui.error = message => assert.fail(message);
  try {
    await ui.ready();
    assert.equal(preparations, 1); assert.equal(clockChecks, 1);
    assert.deepEqual(requests, [{ type: 'ready', ready: true, version: 7 }]);
    assert.deepEqual(ui.prepared, { buffer, trackId: track.id, version: 7 });
    await ui.ready(); assert.equal(requests[1].ready, false); assert.equal(preparations, 1);
  } finally { globalThis.document = originalDocument; }
});
