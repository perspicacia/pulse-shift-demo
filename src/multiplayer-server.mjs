import { randomBytes, randomUUID } from 'node:crypto';

const difficulties = ['easy', 'normal', 'hard'];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const freshStats = () => ({ score: 0, combo: 0, maxCombo: 0, accuracy: 100, status: 'waiting' });
export class RoomStore {
  constructor(tracks, { now = Date.now, disconnectGrace = 45000, countdown = 4000 } = {}) {
    this.tracks = new Map(tracks.map(track => [track.id, track]));
    this.rooms = new Map(); this.tokens = new Map(); this.now = now;
    this.disconnectGrace = disconnectGrace; this.countdown = countdown;
  }
  nickname(value) {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 16 || /[\u0000-\u001f\u007f]/.test(value)) fail(400, '닉네임은 1~16자로 입력해주세요.');
    return value.trim();
  }
  config(value) {
    if (!value || !this.tracks.has(value.trackId) || !difficulties.includes(value.difficulty) || value.keyCount !== 4) fail(400, '오리지널 곡과 4키 LEVEL 1·2·3만 함께 플레이할 수 있어요.');
    return { trackId: value.trackId, difficulty: value.difficulty, keyCount: 4 };
  }
  player(nickname) { return { id: randomUUID(), token: randomBytes(24).toString('hex'), nickname: this.nickname(nickname), connected: false, disconnectedAt: this.now(), ready: false, stats: freshStats(), sinks: new Set(), lastStats: 0, lastSequence: -1 }; }
  create(nickname, config) {
    this.sweep();
    if (this.rooms.size >= 100) fail(503, '지금은 방이 많아요. 잠시 후 다시 시도해주세요.');
    let code; do { code = randomBytes(3).toString('hex').toUpperCase(); } while (this.rooms.has(code));
    const host = this.player(nickname), room = { code, hostId: host.id, players: [host], config: this.config(config), version: 1, revision: 1, phase: 'waiting', round: null, reason: '', createdAt: this.now() };
    this.rooms.set(code, room); this.tokens.set(host.token, { room, player: host });
    return this.credentials(room, host);
  }
  join(code, nickname) {
    if (typeof code !== 'string' || !/^[A-F0-9]{6}$/i.test(code.trim())) fail(400, '6자리 방 코드를 입력해주세요.');
    this.sweep(); const room = this.rooms.get(code.trim().toUpperCase());
    if (!room) fail(404, '방을 찾을 수 없어요. 코드를 확인해주세요.');
    if (room.players.length >= 2) fail(409, '이미 두 명이 있는 방이에요.');
    if (['countdown', 'playing'].includes(room.phase)) fail(409, '플레이 중인 방에는 참가할 수 없어요.');
    const player = this.player(nickname); room.players.push(player); this.tokens.set(player.token, { room, player });
    this.reset(room, '새 플레이어가 참가했어요. 둘 다 준비해주세요.'); this.emit(room);
    return this.credentials(room, player);
  }
  credentials(room, player) { return { token: player.token, playerId: player.id, room: this.snapshot(room), serverTime: this.now() }; }
  auth(token) { const entry = this.tokens.get(token); if (!entry) fail(401, '방 연결이 만료됐어요. 다시 참가해주세요.'); return entry; }
  snapshot(room) {
    return { code: room.code, hostId: room.hostId, config: { ...room.config }, version: room.version, revision: room.revision, phase: room.phase, reason: room.reason, round: room.round ? { ...room.round } : null, serverTime: this.now(), players: room.players.map(({ id, nickname, ready, connected, stats }) => ({ id, nickname, ready, connected, stats: { ...stats } })) };
  }
  emit(room) { room.revision++; const data = this.snapshot(room); for (const player of room.players) for (const sink of player.sinks) sink(data); }
  connect(token, sink) {
    const { room, player } = this.auth(token);
    // EventSource reconnects replace the old stream without duplicating a player.
    player.sinks.add(sink); player.connected = true; player.disconnectedAt = null; this.emit(room);
    let closed = false;
    return () => {
      if (closed) return; closed = true; player.sinks.delete(sink);
      if (player.sinks.size || !this.tokens.has(token)) return;
      player.connected = false; player.disconnectedAt = this.now(); player.ready = false;
      if (['countdown', 'playing'].includes(room.phase)) this.reset(room, `${player.nickname} 연결이 끊겨 이번 경기를 중단했어요. 재접속 후 다시 준비해주세요.`);
      this.emit(room);
    };
  }
  reset(room, reason = '') {
    room.phase = 'waiting'; room.round = null; room.reason = reason;
    for (const player of room.players) { player.ready = false; player.stats = freshStats(); player.lastSequence = -1; player.lastStats = 0; }
  }
  remove(room, player, reason) {
    this.tokens.delete(player.token); room.players = room.players.filter(item => item !== player);
    if (!room.players.length) { this.rooms.delete(room.code); return; }
    room.hostId = room.players[0].id; this.reset(room, reason); this.emit(room);
  }
  stats(room, player, value, sequence) {
    const notes = this.tracks.get(room.config.trackId).charts[room.config.difficulty].length;
    if (!value || !Number.isSafeInteger(sequence) || sequence > 1000000 || sequence <= player.lastSequence || !Number.isInteger(value.score) || value.score < player.stats.score || value.score > 1000000 || !Number.isInteger(value.combo) || value.combo < 0 || value.combo > notes || !Number.isInteger(value.maxCombo) || value.maxCombo < player.stats.maxCombo || value.maxCombo < value.combo || value.maxCombo > notes || !Number.isFinite(value.accuracy) || value.accuracy < 0 || value.accuracy > 100) fail(400, '플레이 점수 데이터가 올바르지 않아요.');
    return { score: value.score, combo: value.combo, maxCombo: value.maxCombo, accuracy: Math.round(value.accuracy * 100) / 100, status: 'playing' };
  }
  action(token, body) {
    const { room, player } = this.auth(token); const now = this.now();
    if (!body || typeof body.type !== 'string') fail(400, '방 요청이 올바르지 않아요.');
    if (body.type === 'leave') { this.remove(room, player, `${player.nickname} 님이 나갔어요. 다른 친구를 초대해주세요.`); return { left: true }; }
    if (body.type === 'cancel') { if (['countdown', 'playing'].includes(room.phase)) this.reset(room, `${player.nickname} 님이 경기를 중단했어요. 다시 준비할 수 있어요.`); this.emit(room); return { room: this.snapshot(room) }; }
    if (!player.connected) fail(409, '방 연결이 복구된 다음 다시 시도해주세요.');
    if (body.type === 'config') {
      if (room.hostId !== player.id) fail(403, '호스트만 곡과 난이도를 바꿀 수 있어요.');
      if (!['waiting', 'results'].includes(room.phase)) fail(409, '진행 중에는 곡을 바꿀 수 없어요.');
      room.config = this.config(body.config); room.version++; this.reset(room, '곡 설정이 바뀌었어요. 둘 다 준비해주세요.');
    } else if (body.type === 'ready') {
      if (typeof body.ready !== 'boolean') fail(400, '준비 상태가 올바르지 않아요.');
      if (!['waiting', 'results'].includes(room.phase) || body.version !== room.version) fail(409, '방 설정이 바뀌었어요. 현재 곡을 다시 준비해주세요.');
      if (room.phase === 'results') this.reset(room, '재대전 준비 중이에요.');
      player.ready = body.ready === true;
      if (room.players.length === 2 && room.players.every(item => item.connected && item.ready)) {
        const track = this.tracks.get(room.config.trackId);
        room.round = { id: randomUUID(), startAt: now + this.countdown, duration: track.duration, version: room.version };
        room.phase = 'countdown'; room.reason = '';
        for (const item of room.players) { item.stats = { ...freshStats(), status: 'playing' }; item.lastSequence = -1; }
      }
    } else if (body.type === 'stats' || body.type === 'finish') {
      if (!['countdown', 'playing'].includes(room.phase) || body.roundId !== room.round?.id || player.stats.status === 'finished') fail(409, '이미 종료되거나 바뀐 경기예요.');
      if (now < room.round.startAt) fail(409, '카운트다운이 끝난 후 점수를 전송해주세요.');
      const stats = this.stats(room, player, body.stats, body.sequence);
      if (body.type === 'stats' && now - player.lastStats < 100) return { throttled: true };
      if (body.type === 'finish' && now < room.round.startAt + room.round.duration * 1000 - 1000) fail(409, '곡이 끝난 뒤 결과를 전송해주세요.');
      player.stats = { ...stats, status: body.type === 'finish' ? 'finished' : 'playing' }; player.lastSequence = body.sequence; player.lastStats = now; room.phase = 'playing';
      if (room.players.every(item => item.stats.status === 'finished')) room.phase = 'results';
    } else fail(400, '지원하지 않는 방 요청이에요.');
    this.emit(room); return { room: this.snapshot(room) };
  }
  sweep() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      for (const player of [...room.players]) if (!player.connected && now - player.disconnectedAt > this.disconnectGrace) this.remove(room, player, `${player.nickname} 연결이 만료됐어요. 다른 친구를 초대해주세요.`);
      if (!this.rooms.has(room.code)) continue;
      if (room.phase === 'countdown' && now >= room.round.startAt) { room.phase = 'playing'; this.emit(room); }
      if (room.phase === 'playing' && now > room.round.startAt + room.round.duration * 1000 + 15000) { this.reset(room, '결과 전송 시간이 지나 경기를 중단했어요. 다시 준비해주세요.'); this.emit(room); }
    }
  }
}

export function createMultiplayerHandler(tracks, { now = Date.now, publicOrigin = '', store = new RoomStore(tracks, { now }) } = {}) {
  const attempts = new Map();
  const interval = setInterval(() => { store.sweep(); for (const [key, entry] of attempts) if (now() - entry.start > 60000) attempts.delete(key); }, 1000); interval.unref();
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); };
  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/multiplayer/')) return false;
    try {
      const origin = publicOrigin || `http://${req.headers.host}`;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) fail(403, '같은 게임 주소에서만 방에 연결할 수 있어요.');
      if (req.method === 'GET' && url.pathname === '/api/multiplayer/time') { json(res, 200, { serverTime: now() }); return true; }
      if (req.method === 'GET' && url.pathname === '/api/multiplayer/events') {
        const token = url.searchParams.get('token'); store.auth(token);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no', 'Referrer-Policy': 'no-referrer' });
        res.write('retry: 1500\n\n');
        const close = store.connect(token, data => res.write(`event: room\ndata: ${JSON.stringify(data)}\n\n`));
        const heartbeat = setInterval(() => res.write(`: heartbeat ${now()}\n\n`), 5000); heartbeat.unref();
        req.on('close', () => { clearInterval(heartbeat); close(); }); return true;
      }
      if (req.method !== 'POST') fail(405, '지원하지 않는 요청 방식이에요.');
      if (!req.headers.origin || req.headers['content-type']?.split(';')[0] !== 'application/json') fail(415, '게임 화면에서 JSON 요청을 보내주세요.');
      if (Number(req.headers['content-length'] || 0) > 2048) fail(413, '요청 내용이 너무 커요.');
      let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 2048) fail(413, '요청 내용이 너무 커요.'); }
      let body; try { body = JSON.parse(data); } catch { fail(400, '요청 내용을 읽을 수 없어요.'); }
      if (['/api/multiplayer/rooms', '/api/multiplayer/join'].includes(url.pathname)) {
        const key = req.socket.remoteAddress; let entry = attempts.get(key);
        if (!entry || now() - entry.start > 60000) attempts.set(key, entry = { start: now(), count: 0 });
        if (++entry.count > 20) fail(429, '참가 요청이 많아요. 잠시 후 다시 시도해주세요.');
      }
      if (url.pathname === '/api/multiplayer/rooms') json(res, 201, store.create(body.nickname, body.config));
      else if (url.pathname === '/api/multiplayer/join') json(res, 200, store.join(body.code, body.nickname));
      else if (url.pathname === '/api/multiplayer/action') json(res, 200, store.action(req.headers.authorization?.replace(/^Bearer /, ''), body));
      else fail(404, '방 기능을 찾을 수 없어요.');
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '방 서버에서 오류가 났어요. 다시 시도해주세요.' }); else res.end(); }
    return true;
  }
  handler.store = store; handler.close = () => clearInterval(interval); return handler;
}
