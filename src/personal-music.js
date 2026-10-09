import { validateFile, validateAudio, validateCalibration, makePersonalTrack } from './personal-analysis.js';

export function analyzeAudio(buffer, { signal, onProgress = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('취소됨', 'AbortError')); return; }
    const worker = new Worker(new URL('./personal-worker.js', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout); signal?.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new DOMException('취소됨', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('분석 시간이 길어졌어요. 더 짧은 곡으로 다시 시도해주세요.')), 60000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('박자 분석을 완료하지 못했어요. 다른 파일로 다시 시도해주세요.'));
    worker.onmessage = ({ data }) => {
      if (settled) return;
      if (data.error) finish(new Error(data.error));
      else if (data.result) finish(null, data.result);
      else onProgress(data.stage);
    };
    // Transfer copies, never the live AudioBuffer's storage. Feature extraction
    // and tempo estimation both run off the input/render thread.
    try {
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice());
      worker.postMessage({ channels, sampleRate: buffer.sampleRate }, channels.map(channel => channel.buffer));
    } catch { finish(new Error('분석용 음악 데이터를 준비하지 못했어요. 더 짧은 곡을 선택해주세요.')); }
  });
}

export class PersonalMusic {
  constructor(audio, { canImport, onApply, onTest, onDialog, readProfiles, writeProfiles }) {
    Object.assign(this, { audio, canImport, onApply, onTest, onDialog, readProfiles, writeProfiles });
    this.draft = null; this.current = null; this.generation = 0; this.controller = null; this.busy = false;
    this.$ = id => document.getElementById(id);
    this.dialog = this.$('personal-dialog');
    this.$('personal-open').addEventListener('click', () => this.open());
    this.$('personal-calibrate').addEventListener('click', () => this.open(this.current));
    this.$('personal-file').addEventListener('change', event => { const file = event.target.files[0]; event.target.value = ''; if (file) this.load(file); });
    this.$('personal-close').addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => { this.cancel(); this.draft = null; this.onDialog(); });
    this.$('personal-apply').addEventListener('click', () => this.apply(false));
    this.$('personal-test').addEventListener('click', () => this.apply(true));
    for (const id of ['personal-bpm', 'personal-first-beat']) this.$(id).addEventListener('input', () => this.validate());
    for (const button of this.dialog.querySelectorAll('[data-bpm-factor]')) button.addEventListener('click', () => {
      this.$('personal-bpm').value = Math.round(Number(this.$('personal-bpm').value) * Number(button.dataset.bpmFactor) * 100) / 100; this.validate();
    });
    for (const button of this.dialog.querySelectorAll('[data-beat-nudge]')) button.addEventListener('click', () => {
      this.$('personal-first-beat').value = Math.max(0, Math.round((Number(this.$('personal-first-beat').value) + Number(button.dataset.beatNudge)) * 1000) / 1000); this.validate();
    });
    this.$('personal-reset').addEventListener('click', () => { if (this.draft) { this.setConfig(this.draft.analysis); this.validate(); } });
  }

  cancel() { this.generation++; this.controller?.abort(); this.controller = null; this.busy = false; this.dialog.setAttribute('aria-busy', 'false'); }
  open(track = null) {
    if (!this.canImport()) return;
    this.cancel(); this.draft = track;
    this.$('personal-error').hidden = true;
    this.$('personal-status').textContent = '음악 파일을 선택해주세요.';
    this.$('personal-editor').hidden = !track;
    this.dialog.showModal(); this.onDialog();
    if (track) { this.showDraft(track); this.$('personal-bpm').focus(); } else this.$('personal-file').focus();
  }
  setConfig(config) { this.$('personal-bpm').value = config.bpm; this.$('personal-first-beat').value = config.firstBeat; }
  config() { return { bpm: this.$('personal-bpm').valueAsNumber, firstBeat: this.$('personal-first-beat').valueAsNumber }; }
  error(message) { this.$('personal-error').textContent = message; this.$('personal-error').hidden = false; }
  validate() {
    let valid = !!this.draft && !this.busy;
    this.$('personal-error').hidden = true;
    if (valid) try { validateCalibration(this.config(), this.draft.buffer.duration); }
    catch (error) { this.error(error.message); valid = false; }
    for (const id of ['personal-apply', 'personal-test']) this.$(id).disabled = !valid;
    if (valid) this.drawWaveform();
    return valid;
  }
  showDraft(draft) {
    this.$('personal-editor').hidden = false;
    this.$('personal-title').textContent = draft.title;
    this.$('personal-first-beat').max = Math.max(0, draft.buffer.duration - 2).toFixed(3);
    this.setConfig(draft.config);
    const uncertain = draft.analysis.unstable || draft.analysis.confidence < .55;
    this.$('personal-status').textContent = uncertain ? '박자 추정이 불확실해요. 템포 변화가 있는 곡은 일부 구간이 맞지 않을 수 있어요.' : '분석 완료 · 자동 추정값이에요. 10초 테스트로 확인해주세요.';
    this.validate();
  }
  drawWaveform() {
    const canvas = this.$('personal-waveform'), ctx = canvas.getContext('2d');
    const { waveform, duration } = this.draft.analysis;
    ctx.clearRect(0, 0, 640, 100); ctx.fillStyle = '#0b141e'; ctx.fillRect(0, 0, 640, 100);
    ctx.fillStyle = '#83e8f0'; waveform.forEach((value, i) => { const h = Math.max(2, value * 70); ctx.fillRect(i * 4, (100 - h) / 2, 2, h); });
    const position = this.config().firstBeat / duration * 640;
    ctx.strokeStyle = '#d5ff56'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(position, 8); ctx.lineTo(position, 92); ctx.stroke();
  }
  async load(file) {
    if (!this.canImport() || !this.dialog.open) return;
    this.cancel(); const token = this.generation;
    this.controller = new AbortController(); const signal = this.controller.signal;
    this.busy = true; this.draft = null; this.$('personal-editor').hidden = true;
    this.$('personal-error').hidden = true; this.$('personal-dialog').setAttribute('aria-busy', 'true');
    this.$('personal-status').textContent = '1 / 3 · 음악 파일을 읽고 있어요…';
    try {
      validateFile(file);
      await this.audio.initContext();
      const bytes = await file.arrayBuffer();
      if (token !== this.generation) return;
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const id = 'personal-' + [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
      let buffer;
      try { buffer = await this.audio.context.decodeAudioData(bytes); }
      catch { throw new Error('이 파일을 재생할 수 없어요. MP3·WAV 등 브라우저가 지원하는 음악을 선택해주세요.'); }
      if (token !== this.generation) return;
      validateAudio(buffer.duration, buffer.numberOfChannels);
      const analysis = await analyzeAudio(buffer, { signal, onProgress: stage => { if (token === this.generation) this.$('personal-status').textContent = stage === 'features' ? '2 / 3 · 소리의 변화를 분석하고 있어요…' : '3 / 3 · BPM과 첫 박을 찾고 있어요…'; } });
      if (token !== this.generation) return;
      let config = { bpm: analysis.bpm, firstBeat: analysis.firstBeat };
      const saved = this.readProfiles()[id];
      if (saved) try { config = validateCalibration(saved, buffer.duration); } catch { /* Ignore invalid old settings. */ }
      this.busy = false;
      this.draft = { id, title: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || '내 음악', buffer, analysis, config };
      this.showDraft(this.draft);
    } catch (error) { if (token === this.generation && error.name !== 'AbortError') { this.error(error.message); this.$('personal-status').textContent = '불러오지 못했어요. 이전 곡은 그대로 유지돼요.'; } }
    finally { if (token === this.generation) { this.busy = false; this.$('personal-dialog').setAttribute('aria-busy', 'false'); } }
  }
  apply(test) {
    if (!this.canImport() || !this.validate()) return;
    try {
      const config = this.config(), track = makePersonalTrack({ ...this.draft, config });
      this.current = track;
      const profiles = this.readProfiles(); profiles[track.id] = track.config; this.writeProfiles(profiles);
      this.audio.registerBuffer(track.id, track.buffer);
      this.onApply(track); this.dialog.close();
      if (test) this.onTest(this.$('personal-test-position').value);
    } catch (error) { this.error(error.message); }
  }
}
