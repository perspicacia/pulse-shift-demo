import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { RoomStore, createMultiplayerHandler } from '../src/multiplayer-server.mjs';
const tracks = [{ id: 'original', duration: 12, charts: { easy: Array(16), normal: Array(24), hard: Array(32) } }];
const config = { trackId: 'original', difficulty: 'normal', keyCount: 4 };
const stats = { score: 500000, combo: 4, maxCombo: 8, accuracy: 95.5 };
function fixture() { let now = 1000000; const store = new RoomStore(tracks, { now: () => now }); const host = store.create('호스트', config), guest = store.join(host.room.code, '친구'); const snapshots = []; const closeHost = store.connect(host.token, room => snapshots.push(room)), closeGuest = store.connect(guest.token, room => snapshots.push(room)); return { store, host, guest, snapshots, closeHost, closeGuest, advance: ms => { now += ms; }, ready: () => { store.action(host.token, { type: 'ready', version: 1, ready: true }); return store.action(guest.token, { type: 'ready', version: 1, ready: true }).room; } }; }

test('rooms allow two authenticated players; reject third, private file tracks, bad names and guest config changes', () => {
  const f = fixture(); assert.equal(f.host.token.length, 48); assert.notEqual(f.host.token, f.guest.token);
  assert.throws(() => f.store.join(f.host.room.code, 'third'), /두 명/);
  assert.throws(() => f.store.create('x', { ...config, trackId: 'personal-hash' }), /오리지널/);
  assert.throws(() => f.store.create('x', { ...config, keyCount: 6 }), /4키/);
  assert.throws(() => f.store.create(' ', config), /닉네임/);
  assert.throws(() => f.store.action('fake', { type: 'ready' }), /만료/);
  assert.throws(() => f.store.action(f.guest.token, { type: 'config', config }), /호스트/);
  assert.equal(JSON.stringify(f.store.snapshot(f.store.auth(f.host.token).room)).includes(f.host.token), false);
});
test('both connected ready players start once at the same future server time; changing song invalidates stale readiness', () => {
  const f = fixture(); f.store.action(f.host.token, { type: 'ready', version: 1, ready: true });
  assert.equal(f.store.auth(f.host.token).room.phase, 'waiting');
  f.store.action(f.host.token, { type: 'config', config: { ...config, difficulty: 'hard' } });
  assert.throws(() => f.store.action(f.guest.token, { type: 'ready', version: 1, ready: true }), /바뀌/);
  f.store.action(f.host.token, { type: 'ready', version: 2, ready: true });
  const round = f.store.action(f.guest.token, { type: 'ready', version: 2, ready: true }).room.round;
  assert.equal(round.startAt, 1004000); assert.equal(round.version, 2);
  assert.throws(() => f.store.action(f.host.token, { type: 'ready', version: 2, ready: true }), /바뀌/);
  assert.ok(f.snapshots.slice(-2).every(room => room.round.id === round.id && room.round.startAt === round.startAt));
});
test('live stats are round-scoped, monotonic and bounded; final results require song end and both players', () => {
  const f = fixture(), round = f.ready().round;
  const request = (token, body = {}) => f.store.action(token, { type: 'stats', roundId: round.id, sequence: 1, stats, ...body });
  assert.throws(() => request(f.host.token), /카운트다운/); f.advance(4100);
  const live = request(f.host.token).room; assert.equal(live.players[0].stats.score, 500000);
  assert.throws(() => request(f.host.token), /올바르지/);
  assert.throws(() => request(f.guest.token, { stats: { ...stats, combo: 9999 } }), /올바르지/);
  assert.throws(() => request(f.guest.token, { roundId: 'old' }), /종료/);
  assert.throws(() => request(f.host.token, { type: 'finish', sequence: 2 }), /곡이 끝난/);
  f.advance(12000); const first = request(f.host.token, { type: 'finish', sequence: 2 }).room;
  assert.equal(first.phase, 'playing'); assert.equal(first.players[0].stats.status, 'finished');
  const done = request(f.guest.token, { type: 'finish' }).room; assert.equal(done.phase, 'results');
  const firstRematch = f.store.action(f.host.token, { type: 'ready', version: 1, ready: true }).room;
  assert.equal(firstRematch.phase, 'waiting'); assert.equal(firstRematch.round, null);
  assert.equal(firstRematch.players[0].ready, true); assert.equal(firstRematch.players[1].ready, false);
  const again = f.store.action(f.guest.token, { type: 'ready', version: 1, ready: true }).room;
  assert.notEqual(again.round.id, round.id); assert.equal(again.players[0].stats.score, 0);
});
test('disconnect cancels countdown, reconnect returns to waiting, expired identity is removed and host transfers', () => {
  const f = fixture(); f.ready(); f.closeHost(); const room = f.store.auth(f.guest.token).room;
  assert.equal(room.phase, 'waiting'); assert.equal(room.round, null); assert.equal(room.players[0].connected, false);
  const closeReconnect = f.store.connect(f.host.token, () => {}); assert.equal(room.players[0].connected, true); assert.equal(room.players[0].ready, false);
  closeReconnect(); f.advance(45001); f.store.sweep(); assert.equal(room.players.length, 1); assert.equal(room.hostId, f.guest.playerId);
  assert.throws(() => f.store.auth(f.host.token), /만료/);
});
test('manual cancel and leave invalidate a match; late updates cannot resurrect it', () => {
  const f = fixture(), round = f.ready().round; f.advance(5000);
  f.store.action(f.guest.token, { type: 'cancel' });
  assert.throws(() => f.store.action(f.host.token, { type: 'stats', roundId: round.id, sequence: 1, stats }), /종료/);
  f.store.action(f.host.token, { type: 'leave' }); assert.equal(f.store.auth(f.guest.token).room.hostId, f.guest.playerId);
  f.store.action(f.guest.token, { type: 'leave' }); assert.equal(f.store.rooms.size, 0);
});
test('missing end report times out safely instead of leaving a match running', () => {
  const f = fixture(); f.ready(); f.advance(32000); f.store.sweep();
  assert.equal(f.store.auth(f.host.token).room.phase, 'waiting'); assert.match(f.store.auth(f.host.token).room.reason, /결과 전송/);
});

test('HTTP API validates origins, payload size and types; two SSE clients receive one shared countdown and disconnect cancellation', async () => {
  let now = 1000000; const handler = createMultiplayerHandler(tracks, { now: () => now });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) res.writeHead(404).end('missing'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, extra = {}) => fetch(`${origin}/api/multiplayer/${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...extra.headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const controllers = [];
  async function stream(token) {
    const controller = new AbortController(); controllers.push(controller);
    const response = await fetch(`${origin}/api/multiplayer/events?token=${token}`, { signal: controller.signal }); assert.equal(response.status, 200);
    const reader = response.body.getReader(); let pending = '';
    return { controller, async room() { for (;;) { const match = pending.match(/event: room\ndata: ([^\n]+)\n\n/); if (match) { pending = pending.slice(match.index + match[0].length); return JSON.parse(match[1]); } const { value, done } = await reader.read(); if (done) throw new Error('stream ended'); pending += new TextDecoder().decode(value); } } };
  }
  try {
    assert.equal((await post('rooms', { nickname: 'x', config }, { headers: { Origin: 'https://elsewhere.example' } })).status, 403);
    assert.equal((await post('rooms', 'x'.repeat(3000))).status, 413);
    assert.equal((await post('rooms', '{bad')).status, 400);
    assert.equal((await post('rooms', { nickname: 'x', config }, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    const host = await (await post('rooms', { nickname: 'HOST', config })).json(); const guest = await (await post('join', { nickname: 'GUEST', code: host.room.code })).json();
    const a = await stream(host.token); await a.room(); const b = await stream(guest.token); await b.room();
    const action = (token, body) => post('action', body, { headers: { Authorization: `Bearer ${token}` } });
    await action(host.token, { type: 'ready', version: 1, ready: true });
    const started = await (await action(guest.token, { type: 'ready', version: 1, ready: true })).json(); assert.equal(started.room.phase, 'countdown');
    let ar, br; do { ar = await a.room(); } while (!ar.round); do { br = await b.room(); } while (!br.round);
    assert.equal(ar.round.id, br.round.id); assert.equal(ar.round.startAt, br.round.startAt);
    b.controller.abort(); do { ar = await a.room(); } while (ar.round);
    assert.equal(ar.phase, 'waiting'); assert.match(ar.reason, /接続|연결/);
    assert.equal((await action('unknown', { type: 'cancel' })).status, 401);
  } finally { controllers.forEach(controller => controller.abort()); handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
