// Keep asynchronous menu preparation from starting after a preview/game begins.
export class LobbyMusic {
  constructor(audio, { enabled = true, canPlay, onState = () => {}, onError = () => {} }) {
    this.audio = audio;
    this.enabled = enabled;
    this.canPlay = canPlay;
    this.onState = onState;
    this.onError = onError;
    this.unlocked = false;
    this.failed = false;
    this.generation = 0;
  }

  unlock() {
    if (this.unlocked && !this.failed) return;
    this.unlocked = true;
    this.sync();
  }

  toggle() {
    this.enabled = !this.unlocked || this.failed ? true : !this.enabled;
    this.unlocked = true;
    this.sync();
    return this.enabled;
  }

  allowed() { return this.unlocked && this.enabled && this.canPlay(); }

  sync() {
    const token = ++this.generation;
    if (!this.allowed()) {
      this.audio.stopLobby();
      this.onState(!this.enabled ? 'off' : !this.unlocked ? 'idle' : 'paused');
      return;
    }
    if (this.audio.lobbySource) { this.onState('playing'); return; }
    this.failed = false;
    this.onState('loading');
    // init() resumes the AudioContext immediately inside the trusted gesture.
    this.audio.init('neon-halo').then(buffer => {
      if (token !== this.generation || !this.allowed()) return;
      this.onState(this.audio.playLobby(buffer) ? 'playing' : 'paused');
    }).catch(error => {
      if (token !== this.generation || !this.allowed()) return;
      this.failed = true;
      this.onState('error');
      this.onError(error);
    });
  }
}
