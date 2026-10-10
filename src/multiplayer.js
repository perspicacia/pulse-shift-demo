const $ = id => document.getElementById(id);
const disconnectedMessage = '방 연결이 끊겼어요. 재연결 중이며, 중단된 경기는 다시 준비해야 해요.';

export function estimateServerClock(samples) {
  const usable = samples.filter(item => Number.isFinite(item.serverTime) && Number.isFinite(item.sent) && Number.isFinite(item.received) && item.received >= item.sent);
  if (usable.length < 3) throw new Error('서버 시각을 확인하지 못했어요. 다시 준비해주세요.');
  const best = [...usable].sort((a, b) => a.received - a.sent - (b.received - b.sent))[0];
  const rtt = best.received - best.sent;
  if (rtt > 350) throw new Error('연결 지연이 커서 함께 시작하기 어려워요. 안정적인 연결에서 다시 준비해주세요.');
  return { offset: best.serverTime - (best.sent + best.received) / 2, rtt, sampledAt: best.received };
}

export class MultiplayerClient {
  constructor({ fetcher = globalThis.fetch.bind(globalThis), EventSourceClass = globalThis.EventSource, now = () => performance.now(), onRoom = () => {}, onConnection = () => {}, onError = () => {} } = {}) {
    this.fetcher = fetcher; this.EventSourceClass = EventSourceClass; this.now = now;
    this.onRoom = onRoom; this.onConnection = onConnection; this.onError = onError;
    this.room = null; this.credentials = null; this.source = null; this.clock = null;
    this.sequence = 0; this.lastSend = 0; this.pending = false; this.pendingTask = null; this.generation = 0;
  }
  async request(path, body, token = this.credentials?.token) {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetcher(`/api/multiplayer/${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } : {}, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
      let data; try { data = await response.json(); } catch { throw new Error('이 주소에는 멀티 서버가 없어요. Node 서버로 실행한 게임 주소에서 이용해주세요.'); }
      if (!response.ok) throw new Error(data.error || '방 요청을 완료하지 못했어요.');
      return data;
    } catch (error) { if (error.name === 'AbortError') throw new Error('방 서버 응답이 늦어요. 다시 시도해주세요.'); if (error instanceof TypeError) throw new Error('방 서버에 연결하지 못했어요. 같은 게임 서버 주소를 열었는지 확인해주세요.'); throw error; }
    finally { clearTimeout(timeout); }
  }
  async syncClock() {
    const samples = [];
    for (let index = 0; index < 5; index++) { const sent = this.now(), data = await this.request('time'); samples.push({ sent, received: this.now(), serverTime: data.serverTime }); }
    this.clock = estimateServerClock(samples); return this.clock;
  }
  async enter(path, body) {
    if (this.credentials) throw new Error('현재 방에서 나온 뒤 다른 방에 참가해주세요.');
    const generation = ++this.generation, data = await this.request(path, body, null);
    if (generation !== this.generation) { await this.request('action', { type: 'leave' }, data.token).catch(() => {}); return; }
    this.credentials = { token: data.token, playerId: data.playerId }; this.sequence = 0; this.accept(data.room);
    this.openStream();
  }
  accept(room) { if (!this.credentials || (Number.isFinite(room.revision) && this.room && room.revision < this.room.revision)) return; const previous = this.room; this.room = room; if (room.round?.id !== previous?.round?.id) { this.sequence = 0; this.lastSend = 0; } this.onRoom(room, previous); }
  openStream() {
    this.source?.close();
    const generation = this.generation, source = new this.EventSourceClass(`/api/multiplayer/events?token=${encodeURIComponent(this.credentials.token)}`);
    this.source = source; this.onConnection('connecting');
    source.addEventListener('room', event => { if (generation !== this.generation || source !== this.source) return; try { this.accept(JSON.parse(event.data)); this.onConnection('connected'); clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; } catch { this.onError(new Error('방 상태를 읽지 못했어요.')); } });
    source.onerror = () => {
      if (generation !== this.generation || source !== this.source) return;
      this.onConnection('reconnecting');
      if (this.reconnectTimeout) return;
      this.reconnectTimeout = setTimeout(() => { if (source !== this.source) return; this.onError(new Error('방에 다시 연결하지 못했어요. 나간 뒤 코드로 다시 참가해주세요.')); }, 15000);
    };
  }
  async action(body) { if (!this.credentials) throw new Error('먼저 방을 만들거나 참가해주세요.'); const generation = this.generation; const data = await this.request('action', body); if (generation === this.generation && data.room) this.accept(data.room); return data; }
  async leave() {
    const token = this.credentials?.token; this.generation++; clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null;
    this.source?.close(); this.source = null; this.room = null; this.credentials = null; this.clock = null;
    this.onRoom(null); this.onConnection('off');
    if (token) await this.request('action', { type: 'leave' }, token).catch(() => {});
  }
  sendStats(stats, { finish = false } = {}) {
    const round = this.room?.round;
    if (!round || !this.clock || this.now() + this.clock.offset < round.startAt) return Promise.resolve();
    const roundId = round.id, generation = this.generation;
    if (finish && this.pendingTask) {
      // A result must follow the preceding live update, but never cross into a
      // different round or identity while that update is still in flight.
      return this.pendingTask.then(() => {
        if (generation !== this.generation || this.room?.round?.id !== roundId) return;
        return this.sendStats(stats, { finish: true });
      });
    }
    if (this.pending || (!finish && this.now() - this.lastSend < 250)) return Promise.resolve();
    this.pending = true; this.lastSend = this.now();
    const task = this.action({ type: finish ? 'finish' : 'stats', roundId, sequence: ++this.sequence, stats }).catch(error => { if (generation === this.generation && this.room?.round?.id === roundId) this.onError(error); }).finally(() => { if (this.pendingTask === task) { this.pending = false; this.pendingTask = null; } });
    this.pendingTask = task;
    return task;
  }
}

export class Multiplayer {
  constructor(tracks, { canOpen, onPrepare, onStart, onAbort, onPresence, onDialog, onReplay } = {}) {
    this.tracks = tracks; this.callbacks = { canOpen, onPrepare, onStart, onAbort, onPresence, onDialog, onReplay };
    this.prepared = null; this.activeRound = null; this.seenRounds = new Set(); this.prepareGeneration = 0; this.busy = false; this.connection = 'off';
    this.client = new MultiplayerClient({ onRoom: (room, previous) => this.receive(room, previous), onConnection: state => this.connectionChanged(state), onError: error => this.error(error.message) });
    $('multi-track').replaceChildren(...tracks.map(track => { const option = document.createElement('option'); option.value = track.id; option.textContent = track.title; return option; }));
    $('multi-open').addEventListener('click', () => this.open());
    $('multi-close').addEventListener('click', () => this.close());
    $('multi-dialog').addEventListener('close', () => this.callbacks.onDialog?.());
    $('multi-dialog').addEventListener('cancel', () => this.callbacks.onDialog?.());
    $('multi-create').addEventListener('click', () => this.enter('rooms'));
    $('multi-join').addEventListener('click', () => this.enter('join'));
    $('multi-leave').addEventListener('click', () => this.leave());
    $('multi-ready').addEventListener('click', () => this.ready());
    for (const id of ['multi-track', 'multi-difficulty']) $(id).addEventListener('change', () => this.configure());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel('탭이 숨겨져 이번 경기를 중단했어요.'); });
    window.addEventListener('pagehide', () => {
      if (this.client.credentials) {
        // No file/name/PCM is included. keepalive sends only the opaque room action.
        fetch('/api/multiplayer/action', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.client.credentials.token}` }, body: JSON.stringify({ type: 'leave' }), keepalive: true }).catch(() => {});
        this.client.source?.close();
      }
    });
    this.render();
  }
  get room() { return this.client.room; }
  get playing() { return Boolean(this.activeRound); }
  get inRoom() { return Boolean(this.client.credentials); }
  open() { if (this.callbacks.canOpen && !this.callbacks.canOpen()) return; if (!$('multi-dialog').open) $('multi-dialog').showModal(); this.callbacks.onDialog?.(); this.render(); }
  close() { $('multi-dialog').close(); this.callbacks.onDialog?.(); }
  error(message) { $('multi-error').textContent = message; $('multi-error').hidden = false; }
  clearError() { $('multi-error').hidden = true; }
  async enter(path) {
    if (this.busy) return; this.busy = true; this.clearError(); this.render();
    try { await this.client.enter(path, { nickname: $('multi-nickname').value, ...(path === 'rooms' ? { config: { trackId: $('multi-track').value, difficulty: $('multi-difficulty').value, keyCount: 4 } } : { code: $('multi-code-input').value }) }); }
    catch (error) { this.error(error.message); } finally { this.busy = false; this.render(); }
  }
  async configure() {
    if (!this.room || this.room.hostId !== this.client.credentials?.playerId || this.busy) return;
    const config = { trackId: $('multi-track').value, difficulty: $('multi-difficulty').value, keyCount: 4 };
    this.busy = true; this.clearError(); this.render();
    try { await this.client.action({ type: 'config', config }); }
    catch (error) { this.error(error.message); } finally { this.busy = false; this.render(); }
  }
  async ready() {
    if (!this.room || this.busy || this.connection !== 'connected') return;
    const mine = this.room.players.find(player => player.id === this.client.credentials.playerId);
    if (this.room.phase === 'waiting' && mine?.ready) { await this.client.action({ type: 'ready', ready: false, version: this.room.version }).catch(error => this.error(error.message)); return; }
    const generation = ++this.prepareGeneration, version = this.room.version, track = this.tracks.find(item => item.id === this.room.config.trackId);
    this.busy = true; this.clearError(); this.render();
    try {
      const [buffer] = await Promise.all([this.callbacks.onPrepare(track), this.client.syncClock()]);
      if (generation !== this.prepareGeneration || !this.room || this.room.version !== version || document.hidden) return;
      this.prepared = { buffer, trackId: track.id, version };
      await this.client.action({ type: 'ready', ready: true, version });
    } catch (error) { this.error(error.message); }
    finally { if (generation === this.prepareGeneration) { this.busy = false; this.render(); } }
  }
  receive(room, previous) {
    if (!room || room.version !== previous?.version) { this.prepareGeneration++; this.prepared = null; this.busy = false; }
    if (this.activeRound && room?.round?.id !== this.activeRound) { this.activeRound = null; this.callbacks.onAbort?.(room?.reason || '이번 경기가 중단됐어요.'); }
    this.callbacks.onPresence?.(Boolean(room)); this.render();
    if (room?.phase === 'countdown' && room.round && !this.seenRounds.has(room.round.id)) this.beginRound(room);
  }
  beginRound(room) {
    this.seenRounds.add(room.round.id);
    try {
      if (document.hidden || this.connection === 'reconnecting' || !this.prepared || this.prepared.version !== room.version || this.prepared.trackId !== room.config.trackId || !this.client.clock || performance.now() - this.client.clock.sampledAt > 120000) throw new Error('음악 준비 또는 시각 연결이 만료됐어요. 다시 준비해주세요.');
      const target = room.round.startAt - this.client.clock.offset;
      if (target - performance.now() < 700) throw new Error('시작 안내가 늦게 도착했어요. 경기를 다시 준비해주세요.');
      this.activeRound = room.round.id;
      this.callbacks.onStart({ buffer: this.prepared.buffer, track: this.tracks.find(item => item.id === room.config.trackId), difficulty: room.config.difficulty, targetPerformanceTime: target });
      this.close();
    } catch (error) { this.error(error.message); this.cancel(error.message); }
  }
  connectionChanged(state) {
    this.connection = state;
    if (state === 'reconnecting') {
      this.prepareGeneration++; this.prepared = null; this.busy = false;
      if (this.activeRound) { this.activeRound = null; this.callbacks.onAbort?.(disconnectedMessage); }
      this.error(disconnectedMessage);
    }
    this.render();
  }
  cancel(message = '이번 경기를 중단했어요.') {
    if (!this.activeRound && !['countdown', 'playing'].includes(this.room?.phase)) return;
    this.activeRound = null; this.prepareGeneration++; this.prepared = null; this.busy = false; this.callbacks.onAbort?.(message);
    this.client.action({ type: 'cancel' }).catch(error => this.error(error.message));
    this.error(message); this.render();
  }
  async leave() { this.prepareGeneration++; this.prepared = null; this.busy = false; if (this.activeRound) { this.activeRound = null; this.callbacks.onAbort?.('방에서 나왔어요.'); } await this.client.leave(); this.render(); }
  stats(session) { if (!this.activeRound) return; this.client.sendStats({ score: session.score, combo: session.combo, maxCombo: session.maxCombo, accuracy: session.accuracy }); }
  async finish(session) {
    if (!this.activeRound) return;
    const stats = { score: session.score, combo: session.combo, maxCombo: session.maxCombo, accuracy: session.accuracy };
    // sendStats serializes the final report and keeps it scoped to this round.
    await this.client.sendStats(stats, { finish: true }); this.render();
  }
  replay() { this.callbacks.onReplay?.(); this.open(); }
  render() {
    const room = this.room, ownId = this.client.credentials?.playerId, mine = room?.players.find(player => player.id === ownId), opponent = room?.players.find(player => player.id !== ownId);
    $('multi-entry').hidden = Boolean(room); $('multi-room').hidden = !room;
    $('multi-summary').textContent = room ? `ROOM ${room.code} · ${room.players.length}/2` : '같은 곡으로 함께 시작하고 점수를 겨뤄요.';
    $('multi-open').textContent = room ? `방 ${room.code} 열기` : '2인 멀티';
    $('multi-create').disabled = this.busy; $('multi-join').disabled = this.busy;
    const mutable = !room || room.hostId === ownId && ['waiting', 'results'].includes(room.phase);
    $('multi-track').disabled = this.busy || !mutable; $('multi-difficulty').disabled = this.busy || !mutable;
    if (room) { $('multi-track').value = room.config.trackId; $('multi-difficulty').value = room.config.difficulty; $('multi-code').textContent = room.code; }
    $('multi-status').textContent = this.busy ? '음악·연결 준비 중…' : { off: '같은 게임 서버 주소를 열고 방 코드를 공유하세요.', connecting: '방 연결 중…', reconnecting: '재연결 중 · 중단된 경기는 다시 준비해주세요.', connected: room?.reason || (room?.phase === 'results' ? '경기 완료! 둘 다 다시 준비하면 재대전해요.' : ['countdown', 'playing'].includes(room?.phase) ? '같은 곡으로 플레이 중이에요.' : room?.players.length === 2 ? '둘 다 준비하면 자동으로 함께 시작해요.' : '친구가 참가하기를 기다리고 있어요.') }[this.connection];
    $('multi-status').setAttribute('aria-busy', String(this.busy));
    $('multi-ready').disabled = this.busy || this.connection !== 'connected' || !room || !['waiting', 'results'].includes(room.phase);
    $('multi-ready').textContent = this.busy ? '음악 준비 중…' : room?.phase === 'results' ? '재대전 준비' : mine?.ready ? '준비 취소' : '음악 준비하고 READY';
    $('multi-players').replaceChildren(...(room?.players || []).map(player => { const row = document.createElement('li'), name = document.createElement('strong'), status = document.createElement('span'); name.textContent = `${player.nickname}${player.id === room.hostId ? ' · HOST' : ''}${player.id === ownId ? ' · 나' : ''}`; status.textContent = !player.connected ? '연결 끊김' : player.stats.status === 'finished' ? '플레이 완료' : player.ready ? 'READY' : '준비 전'; row.append(name, status); return row; }));
    $('multi-rtt').textContent = this.client.clock ? `연결 왕복 ${Math.round(this.client.clock.rtt)} ms · 4 KEY` : '오리지널 곡 · 4 KEY · LEVEL 1·2·3';
    $('multi-live').hidden = !room || !this.activeRound;
    $('multi-opponent-name').textContent = opponent?.nickname || '상대 기다리는 중';
    $('multi-opponent-score').textContent = String(opponent?.stats.score || 0).padStart(7, '0');
    $('multi-opponent-combo').textContent = `${opponent?.stats.combo || 0} COMBO · ${(opponent?.stats.accuracy ?? 100).toFixed(2)}%`;
    $('multi-opponent-status').textContent = !opponent?.connected ? '연결 끊김' : opponent?.stats.status === 'finished' ? '플레이 완료' : '플레이 중';
    $('multi-results').hidden = !room || !this.activeRound;
    $('multi-result-status').textContent = room?.phase === 'results' ? (mine?.stats.score === opponent?.stats.score ? 'DRAW · 같은 점수예요.' : mine?.stats.score > opponent?.stats.score ? 'WIN · 멋진 리듬이었어요!' : '다음 대결에서 다시 도전해요.') : '상대의 플레이 완료를 기다리고 있어요.';
    $('multi-result-players').replaceChildren(...(room?.players || []).map(player => { const row = document.createElement('li'); row.textContent = `${player.nickname} · ${player.stats.score.toLocaleString('en-US')}점 · ${player.stats.accuracy.toFixed(2)}% · 최대 ${player.stats.maxCombo}콤보${player.stats.status === 'finished' ? '' : ' · 진행 중'}`; return row; }));
  }
}
