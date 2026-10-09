// Menu playback has its own intent and source, separate from the game clock.
export function previewRange(track, duration = track.duration) {
  const beat = 60 / track.bpm;
  const length = Math.min(32 * beat, duration);
  const offset = Math.max(0, Math.min((track.personal ? track.beatOffset : 0) + track.previewBeat * beat, duration - length));
  return { offset, length };
}

export function previewSamples(channel, sampleRate, { offset, length }) {
  const first = Math.round(offset * sampleRate);
  const frames = Math.min(Math.round(length * sampleRate), channel.length - first);
  const samples = channel.slice(first, first + frames);
  // Preserve the exact beat length and its opening attack. Blend the loop's
  // ending into the audio immediately before that attack, avoiding a hard cut.
  const seam = Math.min(Math.round(0.08 * sampleRate), first, Math.floor(frames / 4));
  for (let i = 0; i < seam; i++) {
    const blend = (i + 1) / seam;
    const last = frames - seam + i;
    samples[last] = samples[last] * (1 - blend) + channel[first - seam + i] * blend;
  }
  return samples;
}

export class SelectedPreview {
  constructor(audio, { canPlay, onState = () => {}, onError = () => {} }) {
    this.audio = audio;
    this.canPlay = canPlay;
    this.onState = onState;
    this.onError = onError;
    this.track = null;
    this.requested = false;
    this.unlocked = false;
    this.failed = false;
    this.status = 'idle';
    this.generation = 0;
    this.pending = null;
  }

  emit(status) { this.status = status; this.onState(status); }
  allowed() { return this.unlocked && this.track && this.requested && this.canPlay(); }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.sync();
  }

  select(track) {
    if (track.id !== this.track?.id) this.invalidate();
    this.track = track;
    this.requested = true;
    this.failed = false;
    this.sync();
  }

  toggle(track = this.track) {
    if (!track) return;
    if (!this.track || track.id !== this.track.id) { this.select(track); return; }
    this.requested = this.failed || !this.requested;
    this.failed = false;
    this.sync();
  }

  invalidate() {
    this.generation++;
    this.pending = null;
    this.audio.stopPreview();
  }

  sync() {
    if (!this.allowed()) {
      this.invalidate();
      this.emit(!this.track || !this.unlocked ? 'idle' : !this.requested ? 'off' : 'paused');
      return;
    }
    if (this.failed) { this.emit('error'); return; }
    if (this.audio.previewSource) { this.emit('playing'); return; }
    if (this.pending === this.track.id) { this.emit('loading'); return; }
    const track = this.track, token = ++this.generation;
    this.pending = track.id;
    this.emit('loading');
    // init() begins context resume inside the original trusted input handler.
    this.audio.init(track.id).then(buffer => {
      if (token !== this.generation || !this.allowed() || this.track.id !== track.id) return;
      this.pending = null;
      const range = previewRange(track, buffer.duration);
      this.emit(this.audio.playPreview(buffer, range) ? 'playing' : 'paused');
    }).catch(error => {
      if (token !== this.generation || !this.allowed()) return;
      this.pending = null;
      this.failed = true;
      this.emit('error');
      this.onError(error);
    });
  }
}
