export const SONG = Object.freeze({ title: 'AFTERGLOW', artist: 'PULSE LAB', bpm: 148, bars: 40, genre: 'ELECTRO / SYNTHWAVE' });
export const BEAT = 60 / SONG.bpm;
export const DURATION = SONG.bars * 4 * BEAT + 2;
export const KEYS = ['KeyD', 'KeyF', 'KeyJ', 'KeyK'];
export const WINDOWS = Object.freeze({ perfect: 45, great: 90, good: 140 });
export const HOLD_RELEASE_GRACE_MS = 80;
export const DIFFICULTIES = Object.freeze({ easy: { level: 1, label: 'LEVEL 1', description: '여유롭게' }, normal: { level: 2, label: 'LEVEL 2', description: '리듬 있게' }, hard: { level: 3, label: 'LEVEL 3', description: '도전하기' } });

export function judge(deltaMs) {
  const delta = Math.abs(deltaMs);
  if (delta <= WINDOWS.perfect) return 'perfect';
  if (delta <= WINDOWS.great) return 'great';
  if (delta <= WINDOWS.good) return 'good';
  return null;
}

// Notes are authored on the same musical grid as the original synth track.
export function createChart(difficulty = 'normal') {
  const step = difficulty === 'easy' ? 2 : difficulty === 'hard' ? 0.5 : 1;
  const phrases = [0, 1, 2, 3, 1, 0, 3, 2, 0, 2, 1, 3, 2, 0, 3, 1];
  const notes = [];
  for (let beat = 8, index = 0; beat < SONG.bars * 4 - 4; beat += step, index++) {
    // A quieter breakdown at bars 17–20, followed by the second drop.
    if (beat >= 64 && beat < 80 && index % 2) continue;
    const lane = phrases[(index + Math.floor(beat / 32) * 3) % phrases.length];
    notes.push({ time: beat * BEAT, lane });
    if (difficulty !== 'easy' && beat >= 32 && beat % 8 === 6) notes.push({ time: beat * BEAT, lane: (lane + 2) % 4 });
  }
  return notes.sort((a, b) => a.time - b.time || a.lane - b.lane).map((note, id) => ({ ...note, id, judged: false }));
}

export class Session {
  constructor(difficulty = 'normal', chart = createChart(difficulty)) {
    this.notes = chart.map((note, id) => {
      if (note.endTime !== undefined && (!Number.isFinite(note.endTime) || note.endTime <= note.time)) throw new RangeError('롱노트 끝은 시작 뒤여야 합니다.');
      return { time: note.time, lane: note.lane, id, judged: false, ...(note.endTime === undefined ? {} : { endTime: note.endTime }) };
    });
    this.chartEnd = Math.max(0, ...this.notes.map(note => note.endTime ?? note.time));
    this.activeHolds = new Map();
    this.combo = 0;
    this.maxCombo = 0;
    this.earned = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.emptyPresses = 0;
    this.offsets = [];
    this.events = [];
    this.expireCursor = 0;
    this.rewardedCombos = new Set();
  }

  resolve(note, type, delta = null) {
    if (note.judged) return null;
    note.judged = true;
    note.holding = false;
    if (this.activeHolds.get(note.lane) === note) this.activeHolds.delete(note.lane);
    this.counts[type]++;
    this.earned += { perfect: 1, great: 0.7, good: 0.3, miss: 0 }[type];
    this.combo = type === 'miss' ? 0 : this.combo + 1;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    if (delta !== null) this.offsets.push(delta);
    const reward = this.combo === 10 || this.combo > 0 && this.combo % 50 === 0;
    const comboMilestone = type !== 'miss' && reward && !this.rewardedCombos.has(this.combo) ? this.combo : 0;
    if (comboMilestone) this.rewardedCombos.add(comboMilestone);
    const event = { type, lane: note.lane, delta, time: note.time, comboMilestone };
    if (note.endTime !== undefined) event.holdComplete = type !== 'miss';
    this.events.push(event);
    return event;
  }

  expire(time) {
    const pending = [];
    // A hold remains pending after its head window; only its tail or a real
    // release resolves it. Suspended holds wait for input recovery on pause.
    for (const note of this.activeHolds.values()) {
      if (!note.suspended && time >= note.endTime) pending.push({ note, type: note.headType, delta: note.headDelta, at: note.endTime });
    }
    while (this.expireCursor < this.notes.length) {
      const note = this.notes[this.expireCursor];
      if (time - note.time <= (WINDOWS.good + 0.000001) / 1000) break;
      if (!note.holding && !note.judged) pending.push({ note, type: 'miss', delta: null, at: note.time + WINDOWS.good / 1000 });
      this.expireCursor++;
    }
    return pending.sort((a, b) => a.at - b.at || a.note.id - b.note.id).map(item => this.resolve(item.note, item.type, item.delta)).filter(Boolean);
  }

  hit(lane, time) {
    this.expire(time);
    if (this.activeHolds.has(lane)) return null;
    const note = this.notes.find(item => !item.judged && item.lane === lane && Math.abs(time - item.time) <= (WINDOWS.good + 0.000001) / 1000);
    if (!note) {
      // Ignore the lead-in and finished chart tail. During the playable chart,
      // a fresh press without a valid note breaks combo, without inventing a
      // chart MISS or changing note-weighted score/accuracy.
      const goodWindow = (WINDOWS.good + 0.000001) / 1000;
      if (!this.notes.length || time < this.notes[0].time - goodWindow || time > this.chartEnd + goodWindow || this.processed === this.notes.length) return null;
      this.combo = 0;
      this.emptyPresses++;
      const event = { type: 'empty', lane, delta: null, time, comboMilestone: 0 };
      this.events.push(event);
      return event;
    }
    const delta = (time - note.time) * 1000;
    // Round only floating-point arithmetic noise at inclusive boundaries.
    const type = judge(Math.round(delta * 1e6) / 1e6);
    if (!type) return null;
    if (note.endTime !== undefined) {
      note.holding = true;
      note.suspended = false;
      note.headType = type;
      note.headDelta = delta;
      this.activeHolds.set(lane, note);
      const event = { type: 'hold', headType: type, lane, delta, time: note.time, comboMilestone: 0 };
      this.events.push(event);
      return event;
    }
    return this.resolve(note, type, delta);
  }

  release(lane, time) {
    const note = this.activeHolds.get(lane);
    if (!note) return null;
    if (note.suspended) return null;
    const success = time >= note.endTime - (HOLD_RELEASE_GRACE_MS + 0.000001) / 1000;
    return this.resolve(note, success ? note.headType : 'miss', success ? note.headDelta : null);
  }

  suspendHolds() {
    for (const note of this.activeHolds.values()) note.suspended = true;
  }

  recoverHold(lane, down = true) {
    const note = this.activeHolds.get(lane);
    if (!note) return false;
    note.suspended = !down;
    return true;
  }

  get pendingHoldLanes() { return [...this.activeHolds.values()].filter(note => note.suspended).map(note => note.lane); }

  finish(time) {
    const resolved = this.expire(time);
    // An interrupted or invalid unfinished hold cannot disappear at song end.
    for (const note of this.notes) if (!note.judged) resolved.push(this.resolve(note, 'miss'));
    return resolved;
  }

  get nextComboMilestone() {
    if (this.notes.length >= 10 && !this.rewardedCombos.has(10)) return 10;
    for (let count = 50; count <= this.notes.length; count += 50) if (!this.rewardedCombos.has(count)) return count;
    return 0;
  }

  get processed() { return Object.values(this.counts).reduce((sum, count) => sum + count, 0); }
  get fullCombo() { return this.notes.length > 0 && this.processed === this.notes.length && this.counts.miss === 0 && this.emptyPresses === 0; }
  get score() { return this.notes.length ? Math.round(this.earned / this.notes.length * 1000000) : 0; }
  get accuracy() { return this.processed ? this.earned / this.processed * 100 : 100; }
  get grade() {
    const accuracy = this.accuracy;
    return accuracy >= 99 ? 'S' : accuracy >= 95 ? 'A' : accuracy >= 85 ? 'B' : accuracy >= 70 ? 'C' : 'D';
  }
}
