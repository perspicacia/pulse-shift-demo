import { createPercussion, createComboCue, localMusicLevel } from './feedback-sound.js';

export class AudioEngine {
  constructor() {
    this.context = null;
    this.source = null;
    this.buffer = null;
    this.volume = 0.65;
    this.effectsVolume = 0.7;
    this.comboVolume = 0.8;
    this.lobbyVolume = 0.3;
    this.lobbySource = null;
    this.lobbyGain = null;
    this.lobbyFades = new Set();
    this.feedbackSources = new Set();
    this.comboBuffers = {};
    this.comboSource = null;
    this.nextComboAt = 0;
    this.percussionBuffers = {};
    this.musicChannels = [];
    this.startTime = 0;
    this.offset = 0;
    this.pausedTime = null;
    this.pausedContextTime = null;
    this.musicReady = new Map();
    this.musicBuffers = new Map();
    this.originalBuffer = null;
  }

  async initContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('이 브라우저에서는 오디오를 사용할 수 없어요. 최신 Chrome이나 Safari로 열어주세요.');
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.context.destination);
      for (const [name, volume] of [['musicBus', this.volume], ['lobbyBus', this.lobbyVolume], ['effectsBus', this.effectsVolume], ['comboBus', this.comboVolume]]) {
        this[name] = this.context.createGain();
        this[name].gain.value = volume;
        this[name].connect(this.master);
      }
    }
    await this.context.resume();
  }

  async init(trackId = 'afterglow') {
    await this.initContext();
    if (!this.musicReady.has(trackId)) this.musicReady.set(trackId, new Promise((resolve, reject) => {
      // The menu must be audible promptly after the first gesture. This original
      // loop is rendered at build time; playable compositions still use workers.
      if (trackId === 'neon-halo') {
        fetch(new URL('../assets/music/neon-halo.wav', import.meta.url))
          .then(response => {
            if (!response.ok) throw new Error('대기 음악을 불러오지 못했어요. 다시 켜기를 눌러주세요.');
            return response.arrayBuffer();
          })
          .then(data => this.context.decodeAudioData(data))
          .then(buffer => { this.musicBuffers.set(trackId, buffer); resolve(buffer); }, reject);
        return;
      }
      const worker = new Worker(new URL('./synth-worker.js', import.meta.url), { type: 'module' });
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error('음악 준비 시간이 길어졌어요. 다시 시도해주세요.')); }, 30000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timeout);
        worker.terminate();
        if (data.error) { reject(new Error(data.error)); return; }
        const buffer = this.context.createBuffer(2, data.left.length, data.sampleRate);
        buffer.copyToChannel(data.left, 0);
        buffer.copyToChannel(data.right, 1);
        this.musicBuffers.set(trackId, buffer);
        if (trackId === 'afterglow') this.originalBuffer = buffer;
        resolve(buffer);
      };
      worker.onerror = () => { clearTimeout(timeout); worker.terminate(); reject(new Error('음악을 불러오지 못했어요. 새로고침 후 다시 시도해주세요.')); };
      worker.postMessage({ type: 'render', trackId });
    }).catch(error => { this.musicReady.delete(trackId); throw error; }));
    return await this.musicReady.get(trackId);
  }

  async prepareFeedback() {
    await this.initContext();
    this.preparePercussion();
    for (const kind of ['light', 'major']) {
      if (this.comboBuffers[kind]) continue;
      const data = createComboCue(this.context.sampleRate, kind);
      const buffer = this.context.createBuffer(1, data.length, this.context.sampleRate);
      buffer.getChannelData(0).set(data);
      this.comboBuffers[kind] = buffer;
    }
  }

  play({ countdown = 0, offset = 0, buffer = this.buffer } = {}) {
    if (!buffer) throw new Error('먼저 음악을 준비해주세요.');
    this.stopLobby();
    this.stop();
    this.buffer = buffer;
    this.musicChannels = buffer.getChannelData ? Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)) : [];
    this.source = this.context.createBufferSource();
    this.source.buffer = buffer;
    this.source.connect(this.musicBus || this.master);
    this.offset = offset;
    this.startTime = this.context.currentTime + countdown + 0.12;
    this.source.start(this.startTime, offset);
    this.pausedTime = null;
    this.pausedContextTime = null;
  }

  outputTime(atPerformanceTime = performance.now()) {
    const stamp = this.context.getOutputTimestamp?.();
    // A suspended context may still report its old output timestamp on resume.
    const fresh = stamp && performance.now() - stamp.performanceTime < 250;
    if (fresh && stamp.contextTime > 0 && stamp.performanceTime > 0) {
      // Timestamp is the audio sample at the output device, mapped to browser time.
      return stamp.contextTime + (atPerformanceTime - stamp.performanceTime) / 1000;
    }
    return this.context.currentTime - (this.context.outputLatency || this.context.baseLatency || 0);
  }

  time(atPerformanceTime) {
    if (this.pausedTime !== null) return this.pausedTime;
    if (!this.source) return 0;
    return this.outputTime(atPerformanceTime) - this.startTime + this.offset;
  }

  async pause() {
    if (!this.source || this.pausedTime !== null) return;
    await this.context.suspend();
    this.pausedContextTime = this.context.currentTime;
    // The context is now frozen; use its exact stopped sample position.
    this.pausedTime = this.context.currentTime - this.startTime + this.offset;
  }

  async resume() {
    if (this.pausedTime === null) return;
    await this.context.resume();
    this.pausedTime = null;
    this.pausedContextTime = null;
  }

  stop() {
    if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); }
    this.source = null;
    this.pausedTime = null;
    this.pausedContextTime = null;
    this.stopFeedback();
  }

  setVolume(volume) {
    this.volume = volume;
    this.setBusVolume(this.musicBus, volume);
  }

  setEffectsVolume(volume) { this.effectsVolume = volume; this.setBusVolume(this.effectsBus, volume); }
  setLobbyVolume(volume) { this.lobbyVolume = volume; this.setBusVolume(this.lobbyBus, volume); }

  playLobby(buffer) {
    if (!buffer || !this.context || this.context.state !== 'running' || this.source || this.lobbyVolume <= 0) return false;
    if (this.lobbySource) return true;
    // Rapid mute/unmute must not stack sources which are still fading out.
    for (const source of this.lobbyFades) { try { source.stop(); } catch {} source.onended?.(); }
    const now = this.context.currentTime;
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.6);
    source.connect(gain).connect(this.lobbyBus);
    source.onended = () => {
      source.disconnect(); gain.disconnect(); this.lobbyFades.delete(source);
      if (this.lobbySource === source) { this.lobbySource = null; this.lobbyGain = null; }
    };
    this.lobbySource = source; this.lobbyGain = gain;
    source.start(now);
    return true;
  }

  stopLobby() {
    if (!this.lobbySource) return;
    const source = this.lobbySource, gain = this.lobbyGain.gain, now = this.context.currentTime;
    this.lobbySource = null; this.lobbyGain = null;
    this.lobbyFades.add(source);
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + 0.08);
    // End before the song's existing 120 ms startup lead-in, without shifting it.
    try { source.stop(now + 0.08); } catch { source.onended?.(); }
  }
  setComboVolume(volume) {
    this.comboVolume = volume;
    this.setBusVolume(this.comboBus, volume);
    if (volume <= 0 && this.comboSource) {
      try { this.comboSource.stop(); } catch {}
      this.comboSource.onended?.();
      this.setBusVolume(this.musicBus, this.volume);
    }
  }

  setBusVolume(bus, volume) {
    if (!bus) return;
    const now = this.context.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setTargetAtTime(volume, now, 0.02);
  }

  trackFeedback(source, nodes = []) {
    this.feedbackSources.add(source);
    source.onended = () => {
      source.disconnect();
      nodes.forEach(node => node.disconnect());
      this.feedbackSources.delete(source);
    };
  }

  stopFeedback() {
    for (const source of this.feedbackSources) { try { source.stop(); } catch {} source.onended?.(); }
    this.feedbackSources.clear();
    this.comboSource = null;
    this.nextComboAt = 0;
    this.setBusVolume(this.musicBus, this.volume);
  }

  preparePercussion() {
    for (const kind of ['hit', 'reward']) {
      if (this.percussionBuffers[kind]) continue;
      const data = createPercussion(this.context.sampleRate, kind);
      const buffer = this.context.createBuffer(1, data.length, this.context.sampleRate);
      buffer.getChannelData(0).set(data);
      this.percussionBuffers[kind] = buffer;
    }
  }

  hitMixGain() {
    if (!this.source || !this.volume) return 0.04;
    const level = localMusicLevel(this.musicChannels, this.buffer?.sampleRate, this.time());
    if (level === null) return 0.04;
    return Math.max(0.008, Math.min(0.075, 0.008 + level * this.volume * 0.8));
  }

  percussion(kind, start, amplitude) {
    this.preparePercussion();
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = this.percussionBuffers[kind];
    gain.gain.value = amplitude;
    source.connect(gain).connect(this.effectsBus);
    this.trackFeedback(source, [gain]);
    source.start(start);
  }

  hit(lane, type = 'perfect') {
    if (!this.context || this.context.state !== 'running' || this.effectsVolume <= 0 || type === 'miss') return;
    const now = this.context.currentTime;
    const power = type === 'perfect' ? 1 : type === 'great' ? 0.72 : 0.5;
    // All lanes use the same unpitched tap; judgment changes strength, not pitch.
    this.percussion('hit', now, this.hitMixGain() * power);
  }

  playCombo(kind, { priority = false, preview = false } = {}) {
    const buffer = Object.hasOwn(this.comboBuffers, kind) ? this.comboBuffers[kind] : null;
    if (!this.context || this.context.state !== 'running' || !buffer || this.comboVolume <= 0) return false;
    const now = this.context.currentTime;
    // Do not queue cues over the music; preview replaces the active cue.
    if (!priority && !preview && (this.comboSource || now < this.nextComboAt)) return false;
    if (this.comboSource) {
      try { this.comboSource.stop(); } catch {}
      this.comboSource.onended?.();
    }
    const cue = this.context.createBufferSource(), level = this.context.createGain();
    cue.buffer = buffer;
    level.gain.value = preview || !this.source ? 0.18 : Math.max(0.08, Math.min(0.2, this.hitMixGain() * 3));
    cue.connect(level).connect(this.comboBus);
    this.trackFeedback(cue, [level]);
    const ended = cue.onended;
    cue.onended = () => {
      ended();
      if (this.comboSource === cue) this.comboSource = null;
    };
    this.comboSource = cue;
    this.nextComboAt = now + buffer.duration + 0.08;
    cue.start(now);
    return true;
  }

  celebrate(milestone = 10) {
    if (!this.context || this.context.state !== 'running') return;
    this.playCombo(milestone >= 50 ? 'major' : 'light', { priority: true });
  }
}
