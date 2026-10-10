import { AudioEngine } from './audio.js';
import { Session, DIFFICULTIES } from './game.js';
import { BUILTIN_TRACKS } from './tracks.js';
import { HitEffects } from './effects.js';
import { highwayGeometry, drawHighway } from './highway.js';
import { LobbyMusic } from './lobby-music.js';
import { SelectedPreview } from './selected-preview.js';
import { PersonalMusic } from './personal-music.js';
import { Multiplayer } from './multiplayer.js';
import { personalTestRange } from './personal-analysis.js';
import { keysFor, chartFor, modeRecordKey, sixKeyDifficulty, sixKeyDifficulties } from './modes.js';

const $ = id => document.getElementById(id);
const audio = new AudioEngine();
const effects = new HitEffects();
const popAnimations = new Map();
let activeTrack = BUILTIN_TRACKS[0];
let personalTrack = null, testRange = null, multiGame = false;
const catalog = () => personalTrack ? [...BUILTIN_TRACKS, personalTrack] : BUILTIN_TRACKS;
const supportedSix = () => activeTrack.personal ? Object.keys(DIFFICULTIES) : sixKeyDifficulties(activeTrack.id);
const colors = { perfect: '#d5ff56', great: '#83e8f0', good: '#ffc984', miss: '#ff888f', empty: '#ff888f', hold: '#83e8f0' };
const laneColors = ['#d5ff56', '#83e8f0', '#83e8f0', '#d5ff56'];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; } };
const saved = read('pulse-shift-settings', {});
const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const settings = {
  keyCount: saved.keyCount === 6 ? 6 : 4,
  volume: clamp(saved.volume, 0, 1, 0.65),
  effectsVolume: clamp(saved.effectsVolume, 0, 1, 0.7),
  comboVolume: clamp(saved.comboVolume ?? saved.voiceVolume, 0, 1, 0.8),
  lobbyVolume: clamp(saved.lobbyVolume, 0, 1, 0.3),
  lobbyEnabled: saved.lobbyEnabled !== false,
  effectIntensity: clamp(saved.effectIntensity, 0, 1, 1),
  speed: clamp(saved.speed, 1, 6, 3),
  offset: clamp(saved.offset, -200, 200, 0),
  difficulty: Object.hasOwn(DIFFICULTIES, saved.difficulty) ? saved.difficulty : 'normal',
};
let records = read('pulse-shift-records', {});
if (!records || typeof records !== 'object') records = {};
let state = 'menu', session = null, actionToken = 0;
let held = new Set(), laneFlashes = [0, 0, 0, 0], lastFeedback = 0;
let celebrationUntil = 0;
let feedbackType = '', uiTime = 0, canvasWidth = 0, canvasHeight = 0, lastNoteIndex = 0;
let toastTimer = 0;
const canvas = $('game-canvas'), ctx = canvas.getContext('2d');
let laneButtons = [...document.querySelectorAll('[data-lane]')];
const inputKeys = () => keysFor(settings.keyCount);
const activeChart = () => chartFor(activeTrack, settings.keyCount, settings.difficulty);
let lobbyStatus = 'idle';
const selectedPreview = new SelectedPreview(audio, {
  canPlay: () => state === 'menu' && !document.hidden && !$('settings-dialog').open && !$('help-dialog').open && !$('personal-dialog').open && !$('multi-dialog').open && settings.volume > 0,
  onState: () => { lobby.sync(); renderMenuMusic(); },
  onError: error => { $('menu-error').textContent = error.message; $('menu-error').hidden = false; },
});
const lobby = new LobbyMusic(audio, {
  enabled: settings.lobbyEnabled,
  canPlay: () => state === 'menu' && !selectedPreview.track && !document.hidden && !$('settings-dialog').open && !$('help-dialog').open && !$('personal-dialog').open && !$('multi-dialog').open && settings.lobbyVolume > 0,
  onState: status => { lobbyStatus = status; renderMenuMusic(); },
  onError: error => toast(error.message),
});

const personalMusic = new PersonalMusic(audio, {
  canImport: () => state === 'menu' && !multiplayer.inRoom,
  onDialog: syncMenuMusic,
  onTest: position => start({ test: true, testPosition: position }),
  readProfiles: () => { const profiles = read('pulse-shift-personal-calibration-v1', {}); return profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {}; },
  writeProfiles: profiles => { if (!write('pulse-shift-personal-calibration-v1', profiles)) toast('보정값을 저장하지 못했어요. 이번 화면에서는 사용할 수 있어요.'); },
  onApply: track => {
    const previous = personalTrack;
    personalTrack = { ...track, number: String(BUILTIN_TRACKS.length + 1).padStart(3, '0') };
    renderPersonalCard();
    selectTrack(personalTrack);
    if (previous && previous.id !== track.id) audio.removeBuffer(previous.id);
  },
});

const multiplayer = new Multiplayer(BUILTIN_TRACKS, {
  canOpen: () => ['menu', 'result'].includes(state),
  onPrepare: prepareAudio,
  onStart: beginMultiplayer,
  onAbort: message => {
    if (multiGame) { multiGame = false; menu(); }
    toast(message);
  },
  onPresence: connected => {
    $('personal-open').disabled = connected; $('personal-calibrate').disabled = connected; $('personal-remove').disabled = connected;
    $('start-label').textContent = connected ? '멀티 방에서 준비하기' : '플레이 시작';
    $('retry-button').textContent = connected ? '멀티 재대전 준비' : '다시 플레이';
    syncMenuMusic();
  },
  onDialog: syncMenuMusic,
  onReplay: () => { multiGame = false; menu(); },
});

function renderBuiltinCards() {
  for (const [index, track] of BUILTIN_TRACKS.entries()) {
    if ($(track.buttonId)) continue;
    const card = document.createElement('button'); card.id = track.buttonId; card.className = 'disc-card'; card.dataset.discCard = ''; card.dataset.builtinTrack = track.id;
    card.innerHTML = '<span class="disc-card-art"><img alt="" width="800" height="800"><img class="disc-record-art" alt="" width="800" height="800"><span class="disc-gloss"></span><span class="disc-hub"></span></span><span class="disc-card-caption"><span class="track-index"></span><strong></strong><small></small></span><span class="selection-label" hidden>선택하기</span>';
    card.querySelector('.disc-card-art > img').src = track.cover;
    card.querySelector('.disc-record-art').src = track.discCover || track.cover.replace('.svg', '-disc.svg');
    card.querySelector('.track-index').textContent = `${String(index + 1).padStart(2, '0')} / ORIGINAL`;
    card.querySelector('strong').textContent = track.title; card.querySelector('small').textContent = `${track.artist} · ${track.bpm} BPM`;
    card.setAttribute('aria-label', `오리지널 곡 ${track.title} 선택`); document.querySelector('.disc-rack').append(card);
  }
}
renderBuiltinCards();

function renderPersonalCard() {
  let card = $('personal-track');
  if (!card) {
    card = document.createElement('button'); card.id = 'personal-track'; card.className = 'disc-card'; card.dataset.discCard = '';
    card.innerHTML = '<span class="disc-card-art"><img src="./assets/personal-disc.svg" alt="" width="800" height="800"><img class="disc-record-art" src="./assets/personal-disc.svg" alt="" width="800" height="800"><span class="disc-gloss"></span><span class="disc-hub"></span></span><span class="disc-card-caption"><span class="track-index">04 / MY MUSIC</span><strong></strong><small></small></span><span class="selection-label" hidden>선택하기</span>';
    card.addEventListener('click', () => selectTrack(personalTrack));
    document.querySelector('.disc-rack').append(card);
  }
  card.querySelector('.track-index').textContent = `${String(BUILTIN_TRACKS.length + 1).padStart(2, '0')} / MY MUSIC`;
  card.setAttribute('aria-label', `개인 음악 ${personalTrack.title} 선택`);
  card.querySelector('.disc-card-caption strong').textContent = personalTrack.title;
  card.querySelector('.disc-card-caption small').textContent = `MY MUSIC · ${personalTrack.bpm} BPM`;
  $('personal-current').textContent = personalTrack.title;
  $('personal-calibrate').hidden = false;
  $('personal-remove').hidden = false;
}

function renderMenuMusic() {
  const chosen = selectedPreview.track;
  const status = chosen ? selectedPreview.status : lobbyStatus;
  const enabled = chosen ? selectedPreview.unlocked && selectedPreview.requested : lobby.unlocked && lobby.enabled;
  const name = chosen ? '선택곡 미리듣기' : '대기 음악';
  $('lobby-music').dataset.state = status;
  $('lobby-music').setAttribute('aria-label', `${name} ${chosen?.title || 'NEON HALO'}`);
  document.querySelector('.lobby-title span').textContent = chosen ? 'SELECTED TRACK' : 'LOBBY RADIO';
  document.querySelector('.lobby-title strong').textContent = chosen?.title || 'NEON HALO';
  $('lobby-toggle').setAttribute('aria-pressed', String(enabled));
  $('lobby-toggle').setAttribute('aria-label', `${name} ${status === 'error' ? '다시 켜기' : enabled ? '끄기' : '켜기'}`);
  $('lobby-toggle-label').textContent = status === 'error' ? '다시 켜기' : enabled ? '끄기' : '켜기';
  $('lobby-toggle').querySelector('use').setAttribute('href', enabled && status !== 'error' ? '#i-pause' : '#i-play');
  const muted = chosen ? settings.volume <= 0 : settings.lobbyVolume <= 0;
  $('lobby-status').textContent = {
    idle: '첫 입력으로 시작 · 곡을 고르면 자동 미리듣기', off: `${name} 꺼짐`, loading: '음악 준비 중…',
    playing: chosen ? '선택곡 미리듣기 반복 재생 중' : '대기 음악 재생 중',
    paused: muted ? `설정에서 ${chosen ? '음악' : '대기 음악'} 음량을 올려주세요` : '잠시 대기 중',
    error: '다시 켜기를 눌러주세요',
  }[status];
  const playing = Boolean(chosen && status === 'playing');
  $('preview-button').setAttribute('aria-pressed', String(playing));
  $('preview-button').setAttribute('aria-label', `${activeTrack.title} ${playing || chosen && status === 'loading' ? '미리듣기 중지' : '음악 미리듣기'}`);
  $('preview-button').disabled = false;
  $('preview-label').textContent = playing ? '미리듣기 중지' : chosen && status === 'loading' ? '준비 중 · 취소' : '미리듣기';
  $('preview-button').querySelector('use').setAttribute('href', playing || chosen && status === 'loading' ? '#i-pause' : '#i-play');
  $('disc-selector').classList.toggle('is-previewing', playing);
  $('deck-state').textContent = !chosen ? 'READY' : { playing: 'PLAYING', loading: 'LOADING', paused: 'PAUSED', error: 'ERROR', off: 'READY', idle: 'READY' }[status];
}

function syncMenuMusic() {
  lobby.sync();
  selectedPreview.sync();
}

function formatTime(time) {
  const value = Math.max(0, Math.round(time));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

function screen(name) {
  for (const item of ['menu', 'game', 'result']) $(`${item}-screen`).hidden = item !== name;
  $('settings-button').disabled = name === 'game';
  $('help-button').disabled = name === 'game';
  document.body.dataset.screen = name;
  syncMenuMusic();
  window.scrollTo(0, 0);
}

function updateBest() {
  const record = currentRecord();
  $('best-score').textContent = Number.isFinite(record?.score) ? record.score.toLocaleString('en-US') : '—';
  $('best-grade').textContent = record?.grade ? `${record.grade} RANK · ${Number(record.accuracy).toFixed(2)}%` : 'NO RECORD';
}

function recordKey() { return modeRecordKey(activeTrack.id, settings.difficulty, settings.keyCount) + (activeTrack.personal ? `:${activeTrack.revision}` : ''); }
function currentRecord() {
  if (activeTrack.personal) return records[recordKey()] || null;
  return records[recordKey()] || (settings.keyCount === 4 ? records[`${activeTrack.id}:${settings.difficulty}`] || (activeTrack.id === 'afterglow' ? records[settings.difficulty] : null) : null);
}

function updateTrack() {
  const track = activeTrack;
  $('track-title').textContent = track.title;
  $('track-title').title = track.title;
  $('track-artist').textContent = track.personal ? 'MY MUSIC — AUTO CHART' : 'PULSE LAB — ORIGINAL MIX';
  $('track-source').textContent = track.personal ? 'MY MUSIC' : 'ORIGINAL';
  $('track-genre').textContent = track.genre;
  $('track-description').textContent = track.description;
  $('cover-badge').textContent = track.personal ? 'MY MUSIC' : 'PULSE ORIGINAL';
  $('deck-title').textContent = track.title;
  document.querySelector('.art-column').classList.toggle('tidal-art', track.id === 'tidal-circuit');
  for (const image of document.querySelectorAll('[data-cover]')) { image.src = track.cover; image.alt = `${track.title} 앨범 아트`; }
  $('stage-cover').src = track.cover;
  $('preview-button').setAttribute('aria-label', `${track.title} 음악 미리듣기`);
  $('bpm-heading').textContent = track.personal ? 'BPM · 보정값' : 'BPM';
  $('bpm-label').textContent = track.bpm;
  $('duration-label').textContent = formatTime(track.duration);
  $('game-title').textContent = track.title;
  $('play-title').textContent = track.title;
  $('play-artist').textContent = track.artist;
  $('play-source').textContent = `${track.personal ? 'MY MUSIC' : 'PULSE ORIGINAL'} / ${track.number}`;
  $('play-bpm').textContent = `${track.bpm} BPM`;
  $('result-title').textContent = track.title;
  $('result-song-meta').textContent = `${track.artist} / ${track.bpm} BPM`;
  $('collection-name').textContent = 'DISC COLLECTION';
  const count = String(catalog().length).padStart(2, '0');
  $('collection-count').textContent = `/ ${count}`;
  $('tracklist-count').textContent = count;
  for (const { buttonId: id, id: trackId } of catalog()) {
    const selected = trackId === track.id;
    $(id).setAttribute('aria-pressed', String(selected));
    $(id).querySelector('.selection-label').textContent = selected ? 'SELECTED' : '선택하기';
  }
  updateDiscSelector();
  updateSettings(false);
}

function updateDiscSelector() {
  const tracks = catalog(), current = tracks.findIndex(track => track.id === activeTrack.id);
  tracks.forEach((track, index) => {
    // Keep three discs around the player, including across the first/last song.
    let slot = index - current;
    if (tracks.length > 2) {
      const half = Math.floor(tracks.length / 2);
      if (slot > half) slot -= tracks.length;
      if (slot < -half) slot += tracks.length;
    }
    const card = $(track.buttonId);
    card.hidden = Math.abs(slot) > 1;
    card.dataset.position = String(slot);
    card.style.setProperty('--slot', slot);
    card.style.setProperty('--tilt', `${Math.sign(slot) * 12}deg`);
    card.setAttribute('aria-description', slot === 0 ? '중앙에 놓인 곡입니다. Enter로 플레이를 시작하세요.' : '선택하면 LP 턴테이블에 올라갑니다.');
  });
  $('disc-current').textContent = String(current + 1).padStart(2, '0');
  $('disc-selection-status').textContent = `${activeTrack.title}, ${current + 1}/${tracks.length} 곡 선택됨`;
}

function stepTrack(direction, focusDisc = false) {
  if (state !== 'menu') return;
  const tracks = catalog(), index = tracks.findIndex(track => track.id === activeTrack.id);
  selectTrack(tracks[(index + direction + tracks.length) % tracks.length]);
  if (focusDisc) $(activeTrack.buttonId).focus({ preventScroll: true });
}

function selectTrack(track) {
  if (state !== 'menu' || !track) return;
  actionToken++;
  if (track !== activeTrack) selectedPreview.invalidate();
  if (track.id !== activeTrack.id) audio.stop();
  activeTrack = track;
  $('menu-error').hidden = true;
  selectedPreview.select(track);
  updateTrack();
}

async function prepareAudio(track = activeTrack) {
  await audio.initContext();
  await audio.prepareFeedback().catch(error => toast(error.message));
  return track.personal ? track.buffer : await audio.init(track.id);
}


function updateModeUI() {
  const keys = inputKeys(), six = settings.keyCount === 6;
  document.body.dataset.keyCount = String(settings.keyCount);
  for (const button of document.querySelectorAll('button[data-key-count]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.keyCount) === settings.keyCount));
    button.disabled = Number(button.dataset.keyCount) === 6 && !supportedSix().length;
  }
  for (const button of document.querySelectorAll('[data-difficulty]')) button.disabled = six && !supportedSix().includes(button.dataset.difficulty);
  for (const id of ['play-key-count', 'stage-key-count']) $(id).textContent = `${settings.keyCount} KEY${six ? ' · 실험' : ''}`;
  const suffix = document.createElement('span'); suffix.className = 'stat-suffix'; suffix.textContent = ' KEY';
  $('menu-key-count').replaceChildren(String(settings.keyCount), suffix);
  $('header-key-count').textContent = `${settings.keyCount} KEY RHYTHM${six ? ' · EXPERIMENT' : ' EXPERIENCE'}`;
  $('settings-key-count').textContent = `${settings.keyCount} KEY LAYOUT`;
  document.title = `PULSE SHIFT · ${settings.keyCount} KEY RHYTHM${six ? ' · 실험' : ''}`;
  $('mode-hint').textContent = activeTrack.personal ? `개인 음악 자동 채보 · ${settings.keyCount}키 LEVEL 1·2·3 · 일반 노트` : six
    ? `6키 실험 · ${activeTrack.title} ${DIFFICULTIES[settings.difficulty].label} · S D F / J K L${activeTrack.id === 'astral-veil' && settings.difficulty === 'normal' ? ' · 롱노트 포함' : ''}`
    : '6키 실험: AFTERGLOW LEVEL 1 / ASTRAL VEIL LEVEL 2·3';
  const labels = keys.map(key => key.slice(3));
  $('game-canvas').setAttribute('aria-label', `${settings.keyCount}개 레인, ${labels.join(' ')} 키로 플레이하세요.`);
  $('help-key-text').textContent = labels.join(' · ');
  const controls = document.querySelector('.lane-controls');
  if (controls.dataset.keyCount === String(settings.keyCount)) return;
  clearHeld();
  controls.dataset.keyCount = String(settings.keyCount);
  controls.style.gridTemplateColumns = `repeat(${keys.length}, minmax(0, 1fr))`;
  controls.replaceChildren(...labels.map((label, lane) => {
    const button = document.createElement('button');
    button.dataset.lane = String(lane); button.textContent = label;
    button.setAttribute('aria-label', `${lane + 1}번째 레인 ${label}`);
    return button;
  }));
  laneButtons = [...controls.children]; laneFlashes = keys.map(() => 0);
  bindLaneControls();
  for (const row of document.querySelectorAll('.key-row, .help-keys')) {
    const children = [];
    labels.forEach((label, index) => {
      if (index === labels.length / 2 && row.classList.contains('key-row')) {
        const gap = document.createElement('span'); gap.className = 'key-gap'; children.push(gap);
      }
      const kbd = document.createElement('kbd'); kbd.textContent = label; children.push(kbd);
    });
    row.replaceChildren(...children);
  }
}

function updateSettings(persist = true) {
  if (settings.keyCount === 6) {
    const supported = supportedSix();
    if (!supported.length) settings.keyCount = 4;
    else if (!supported.includes(settings.difficulty)) settings.difficulty = sixKeyDifficulty(activeTrack.id);
  }
  updateModeUI();
  $('speed-value').textContent = `× ${settings.speed.toFixed(1)}`;
  $('offset-value').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset} ms`;
  $('speed-input').value = settings.speed;
  $('offset-input').value = settings.offset;
  $('volume-input').value = Math.round(settings.volume * 100);
  $('speed-output').textContent = `×${settings.speed.toFixed(1)}`;
  $('offset-output').textContent = $('offset-value').textContent;
  $('volume-output').textContent = `${Math.round(settings.volume * 100)}%`;
  for (const [id, field] of [['effects-volume', 'effectsVolume'], ['combo-volume', 'comboVolume'], ['lobby-volume', 'lobbyVolume'], ['effect-intensity', 'effectIntensity']]) {
    $(id + '-input').value = Math.round(settings[field] * 100);
    $(id + '-output').textContent = `${Math.round(settings[field] * 100)}%`;
  }
  audio.setVolume(settings.volume);
  audio.setEffectsVolume(settings.effectsVolume);
  audio.setComboVolume(settings.comboVolume);
  audio.setLobbyVolume(settings.lobbyVolume);
  syncMenuMusic();
  const chart = activeChart(), holds = chart.filter(note => note.endTime !== undefined).length;
  $('note-count').textContent = `${chart.length} NOTES${holds ? ` · ${holds} HOLD` : ''}`;
  for (const button of document.querySelectorAll('[data-difficulty]')) button.setAttribute('aria-pressed', button.dataset.difficulty === settings.difficulty);
  updateBest();
  if (persist) write('pulse-shift-settings', settings);
}

function preview() {
  if (state !== 'menu') return;
  $('menu-error').hidden = true;
  selectedPreview.toggle(activeTrack);
}

function clearHeld() {
  held.clear();
  session?.suspendHolds();
  laneButtons.forEach(button => { button.classList.remove('pressed'); button.setAttribute('aria-pressed', 'false'); });
  if (state === 'paused') updateHoldRecovery();
}

async function start({ test = false, testPosition = 'start' } = {}) {
  if (!['menu', 'result'].includes(state)) return;
  if (multiplayer.inRoom) { multiplayer.open(); return; }
  multiGame = false;
  state = 'loading';
  $('pause-button').innerHTML = '<svg aria-hidden="true"><use href="#i-pause"/></svg>일시정지 <kbd>ESC</kbd>';
  const token = ++actionToken;
  syncMenuMusic();
  $('menu-error').hidden = true;
  $('start-button').disabled = true;
  $('retry-button').disabled = true;
  $('start-label').textContent = '음악 준비 중…';
  try {
    const buffer = await prepareAudio();
    if (token !== actionToken) return;
    testRange = test && activeTrack.personal ? personalTestRange(activeTrack, testPosition) : null;
    const chart = testRange ? activeChart().filter(note => note.time >= testRange.from && note.time < testRange.to - .15) : activeChart();
    if (!chart.length) throw new Error('선택한 테스트 구간에 노트가 없어요. 다른 구간이나 보정값을 선택해주세요.');
    session = new Session(settings.difficulty, chart);
    clearEffects(); laneFlashes.fill(0); clearHeld(); lastNoteIndex = 0; lastFeedback = 0;
    $('judgment-label').textContent = '';
    $('combo-label').textContent = '';
    $('combo-caption').textContent = '';
    $('timing-label').textContent = '';
    $('play-elapsed').textContent = '00:00';
    $('play-progress').style.width = '0%';
    const difficulty = DIFFICULTIES[settings.difficulty];
    $('game-difficulty').textContent = `${difficulty.label}${testRange ? ' · SYNC TEST' : ''}`;
    $('stage-speed').textContent = `SPEED ×${settings.speed.toFixed(1)}`;
    $('play-duration').textContent = formatTime(testRange ? testRange.to - testRange.from : activeTrack.duration);
    audio.play({ buffer, countdown: 3, offset: testRange?.from || 0 });
    state = 'playing';
    screen('game');
    resizeCanvas();
    updateLive();
    $('pause-button').focus({ preventScroll: true });
    if (document.hidden) pause();
  } catch (error) {
    state = 'menu';
    testRange = null;
    screen('menu');
    $('menu-error').textContent = error.message;
    $('menu-error').hidden = false;
  } finally {
    $('start-button').disabled = false;
    $('retry-button').disabled = false;
    $('start-label').textContent = '플레이 시작';
  }
}

function beginMultiplayer({ buffer, track, difficulty, targetPerformanceTime }) {
  actionToken++;
  if ($('pause-dialog').open) $('pause-dialog').close();
  state = 'menu'; activeTrack = track; settings.keyCount = 4; settings.difficulty = difficulty;
  selectedPreview.invalidate(); updateTrack();
  multiGame = true; testRange = null; session = new Session(difficulty, activeChart());
  clearEffects(); laneFlashes.fill(0); clearHeld(); lastNoteIndex = 0; lastFeedback = 0;
  for (const id of ['judgment-label', 'combo-label', 'combo-caption', 'timing-label']) $(id).textContent = '';
  $('play-elapsed').textContent = '00:00'; $('play-progress').style.width = '0%';
  $('game-difficulty').textContent = `${DIFFICULTIES[difficulty].label} · DUO`;
  $('stage-speed').textContent = `SPEED ×${settings.speed.toFixed(1)}`;
  $('play-duration').textContent = formatTime(track.duration);
  $('pause-button').innerHTML = '경기 중단 <kbd>ESC</kbd>';
  audio.playAt(buffer, targetPerformanceTime);
  state = 'playing'; screen('game'); resizeCanvas(); updateLive();
  $('pause-button').focus({ preventScroll: true });
}

async function pause() {
  if (state !== 'playing') return;
  if (multiGame) { multiplayer.cancel('멀티 경기를 중단했어요. 방에서 다시 준비해주세요.'); return; }
  for (const event of session.expire(audio.time() - settings.offset / 1000)) feedback(event);
  state = 'pausing';
  session.suspendHolds();
  clearHeld();
  try {
    await audio.pause();
    state = 'paused';
    $('pause-error').hidden = true;
    setupHoldRecovery();
    $('pause-dialog').showModal();
    $('resume-button').focus();
  } catch {
    state = 'playing';
    for (const note of [...session.activeHolds.values()]) feedback(session.resolve(note, 'miss'));
    toast('일시정지하지 못했어요. 다시 시도해주세요.');
  }
}

async function resume() {
  if (state !== 'paused') return;
  if (session.pendingHoldLanes.length) {
    updateHoldRecovery();
    $('hold-recovery-status').focus({ preventScroll: true });
    return;
  }
  state = 'resuming';
  $('resume-button').disabled = true;
  try {
    await audio.resume();
    // A release can arrive while AudioContext.resume() is pending.
    if (session.pendingHoldLanes.length) {
      await audio.pause();
      state = 'paused';
      updateHoldRecovery();
      return;
    }
    state = 'playing';
    $('pause-dialog').close();
    $('pause-button').focus({ preventScroll: true });
  } catch {
    state = 'paused';
    $('pause-error').textContent = '음악을 재개하지 못했어요. 다시 눌러주세요.';
    $('pause-error').hidden = false;
  } finally { $('resume-button').disabled = false; }
}

function menu() {
  if (multiGame && multiplayer.playing && state === 'playing') { multiplayer.cancel(); return; }
  multiGame = false;
  actionToken++;
  audio.stop();
  state = 'menu';
  clearHeld();
  clearEffects();
  if ($('pause-dialog').open) $('pause-dialog').close();
  screen('menu');
  updateBest();
  $('start-button').focus({ preventScroll: true });
}

function finish() {
  if (state !== 'playing') return;
  session.finish((testRange?.to ?? activeTrack.duration) + 1);
  state = 'result';
  audio.stop();
  clearHeld();
  clearEffects();
  const previous = currentRecord();
  const newBest = !testRange && !multiGame && (!previous || session.score > previous.score);
  if (newBest) {
    records[recordKey()] = { score: session.score, accuracy: session.accuracy, grade: session.grade, maxCombo: session.maxCombo };
    if (!write('pulse-shift-records', records)) toast('기록 저장이 차단되어 이번 결과만 표시돼요.');
  }
  $('result-difficulty').textContent = `${DIFFICULTIES[settings.difficulty].label} · ${settings.keyCount} KEY${settings.keyCount === 6 ? ' · 실험' : ''}${testRange ? ' · SYNC TEST' : ''}`;
  $('result-grade').textContent = session.grade;
  $('result-score').textContent = session.score.toLocaleString('en-US');
  $('result-accuracy').textContent = `${session.accuracy.toFixed(2)}%`;
  $('result-combo').textContent = session.maxCombo;
  for (const [type, count] of Object.entries(session.counts)) $(`result-${type}`).textContent = count;
  $('new-record').hidden = !newBest || session.score === 0;
  $('clear-status').textContent = multiGame ? 'DUO PLAY · 솔로 기록 저장 안 함' : testRange ? 'SYNC TEST · 기록 저장 안 함' : session.fullCombo ? 'FULL COMBO' : `TRACK FINISHED${session.emptyPresses ? ` · EMPTY ${session.emptyPresses}` : ''}`;
  $('result-message').textContent = testRange ? '테스트 완료. 박자·노트 보정에서 조정해보세요.' : { S: '완벽에 가까운 비트.', A: '리듬을 제대로 탔어요.', B: '좋은 리듬이었어요.', C: '조금씩 비트가 맞아가요.', D: '다음 비트는 더 가까이.' }[session.grade];
  if (multiGame) multiplayer.finish(session);
  screen('result');
  $('retry-button').focus({ preventScroll: true });
}

function updateLive() {
  if (!session) return;
  $('live-score').textContent = String(session.score).padStart(7, '0');
  $('live-accuracy').innerHTML = `${session.accuracy.toFixed(2)}<small>%</small>`;
  $('live-max-combo').textContent = session.maxCombo;
  laneButtons.forEach((button, lane) => {
    const holding = session.activeHolds.has(lane);
    button.classList.toggle('holding', holding);
    button.setAttribute('aria-pressed', String(button.classList.contains('pressed')));
  });
  for (const [type, count] of Object.entries(session.counts)) $(`count-${type}`).textContent = count;
  const target = session.nextComboMilestone;
  const charge = target ? Math.min(session.combo / target, 1) : 1;
  $('combo-charge-value').textContent = target ? `${session.combo} / ${target}` : '보상 완료';
  $('combo-charge').setAttribute('aria-valuenow', Math.round(charge * 100));
  $('combo-charge').setAttribute('aria-valuetext', target ? `현재 ${session.combo}콤보, 다음 보상 ${target}콤보` : '이번 곡의 콤보 보상 완료');
  [...$('combo-charge').children].forEach((segment, i) => segment.classList.toggle('charged', i < Math.floor(charge * 10)));
}

function pop(id, scale, duration) {
  popAnimations.get(id)?.cancel();
  if (reducedMotion.matches || settings.effectIntensity <= 0) return;
  popAnimations.set(id, $(id).animate([
    { transform: `scale(${scale})` }, { transform: 'scale(1)' },
  ], { duration, easing: 'cubic-bezier(.16,1,.3,1)' }));
}

function clearEffects() {
  effects.clear();
  popAnimations.forEach(animation => animation.cancel());
  popAnimations.clear();
  celebrationUntil = 0;
  $('celebration-banner').hidden = true;
  document.querySelector('.stage').classList.remove('celebrating');
}

function celebrate(event, now) {
  $('celebration-title').textContent = `${event.comboMilestone} COMBO!`;
  $('celebration-caption').textContent = 'FEEL THE FLOW';
  $('celebration-banner').hidden = false;
  celebrationUntil = now + 1250;
  effects.celebrate(now, settings.effectIntensity, reducedMotion.matches);
  document.querySelector('.stage').classList.toggle('celebrating', settings.effectIntensity > 0 && !reducedMotion.matches);
  pop('celebration-banner', 0.75, 380);
  audio.celebrate(event.comboMilestone);
}

function feedback(event, now = performance.now()) {
  if (!event) return;
  feedbackType = event.type;
  lastFeedback = now;
  $('judgment-label').textContent = event.type.toUpperCase();
  $('judgment-label').style.color = colors[event.type];
  $('judgment-label').style.opacity = 1;
  pop('judgment-label', event.type === 'perfect' ? 1.2 : 1.08, 180);
  $('combo-label').textContent = session.combo > 0 ? session.combo : '';
  $('combo-caption').textContent = session.combo > 0 ? 'COMBO' : '';
  if (session.combo > 0) pop('combo-label', 1.12, 140);
  $('timing-label').textContent = event.type === 'hold' ? '끝까지 누르고 있어요' : event.holdComplete ? 'HOLD COMPLETE' : event.type === 'empty' ? '노트 없는 입력 · 콤보 끊김' : event.delta === null ? '' : Math.abs(event.delta) < 10 ? 'ON THE BEAT' : `${event.delta < 0 ? 'EARLY' : 'LATE'} ${Math.abs(Math.round(event.delta))} ms`;
  if (event.delta !== null) {
    $('timing-marker').style.left = `${clamp(50 + event.delta / 2.8, 0, 100, 50)}%`;
    laneFlashes[event.lane] = now;
    const type = event.headType || event.type;
    effects.hit(event.lane, type, now, settings.effectIntensity, reducedMotion.matches, settings.keyCount);
    if (!event.holdComplete) audio.hit(event.lane, type);
  }
  if (event.comboMilestone) celebrate(event, now);
  updateLive();
}

function press(lane, token, timestamp = performance.now()) {
  if (held.has(token)) return;
  if (state === 'paused' && session.activeHolds.has(lane)) {
    held.add(token);
    laneButtons[lane].classList.add('pressed');
    session.recoverHold(lane);
    updateHoldRecovery();
    return;
  }
  if (state !== 'playing') return;
  held.add(token);
  laneButtons[lane].classList.add('pressed');
  // Positive calibration delays both the visible hit line crossing and judgment.
  const time = audio.time(timestamp) - settings.offset / 1000;
  if (time < 0) return;
  // A press can run between animation frames. Deliver its expired-note feedback
  // before hit() consumes the expiration events internally.
  for (const event of session.expire(time)) feedback(event);
  const event = session.hit(lane, time);
  updateLive();
  if (event) feedback(event);
}

function release(lane, token, timestamp = performance.now()) {
  if (!held.has(token)) return;
  held.delete(token);
  const stillHeld = [...held].some(value => value === inputKeys()[lane] || value.startsWith(`pointer-${lane}-`) || value.startsWith(`recovery-${lane}-`) || value === `accessible-${lane}`);
  if (stillHeld) return;
  laneButtons[lane].classList.remove('pressed');
  if (state === 'paused' || state === 'resuming') {
    session.recoverHold(lane, false);
    updateHoldRecovery();
  } else if (state === 'playing') {
    const time = audio.time(timestamp) - settings.offset / 1000;
    for (const event of session.expire(time)) feedback(event);
    feedback(session.release(lane, time));
    updateLive();
  }
}

function setupHoldRecovery() {
  const controls = $('hold-recovery-keys');
  controls.replaceChildren(...[...session.activeHolds.keys()].map(lane => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary-button'; button.dataset.holdLane = lane;
    button.textContent = inputKeys()[lane].slice(3);
    button.setAttribute('aria-label', `${button.textContent} 롱노트 다시 누르기`);
    bindLaneControl(button, lane);
    return button;
  }));
  $('hold-recovery').hidden = !session.activeHolds.size;
  updateHoldRecovery();
}

function updateHoldRecovery() {
  const pending = session.pendingHoldLanes.map(lane => inputKeys()[lane].slice(3));
  $('hold-recovery-status').textContent = pending.length ? `${pending.join(' · ')} 키를 다시 누른 채 재개하세요. 음악은 기다리고 있어요.` : '준비됐어요. 키를 유지한 채 재개하세요.';
  for (const button of $('hold-recovery-keys').children) {
    const down = !session.pendingHoldLanes.includes(Number(button.dataset.holdLane));
    button.classList.toggle('pressed', down); button.setAttribute('aria-pressed', String(down));
  }
  updateLive();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvasWidth = rect.width; canvasHeight = rect.height;
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  document.querySelector('.lane-controls').style.width = `${highwayGeometry(rect.width, rect.height).bottomWidth}px`;
}
new ResizeObserver(resizeCanvas).observe(canvas);

function draw(time, now) {
  if (!canvasWidth || !canvasHeight) return;
  while (lastNoteIndex < session.notes.length && (session.notes[lastNoteIndex].judged || (session.notes[lastNoteIndex].endTime ?? session.notes[lastNoteIndex].time) < time - 0.2)) lastNoteIndex++;
  drawHighway(ctx, {
    width: canvasWidth, height: canvasHeight, time, now,
    speed: settings.speed, bpm: activeTrack.bpm, beatOffset: activeTrack.beatOffset,
    notes: session.notes, firstNote: lastNoteIndex, laneCount: settings.keyCount,
    noteColors: settings.keyCount === 6 ? ['#d5ff56', '#83e8f0', '#d5ff56', '#83e8f0', '#d5ff56', '#83e8f0'] : laneColors,
    heldLanes: laneButtons.map(button => button.classList.contains('pressed')),
    flashes: laneFlashes, effects, intensity: settings.effectIntensity, reduced: reducedMotion.matches,
  });
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!['playing', 'paused', 'pausing', 'resuming'].includes(state) || !session) return;
  const songTime = audio.time();
  const time = songTime - settings.offset / 1000;
  if (state === 'playing') {
    for (const event of session.expire(time)) feedback(event, now);
    if (songTime >= (testRange?.to ?? activeTrack.duration) + Math.max(0, settings.offset / 1000)) { finish(); return; }
  }
  draw(time, now);
  if (celebrationUntil && now > celebrationUntil) {
    celebrationUntil = 0;
    $('celebration-banner').hidden = true;
    document.querySelector('.stage').classList.remove('celebrating');
  }
  const elapsed = songTime - (testRange?.from || 0);
  if (elapsed < 0) {
    const number = Math.max(1, Math.ceil(-elapsed));
    const markup = `<span>GET READY</span>${number > 3 ? 3 : number}`;
    if ($('countdown').innerHTML !== markup) $('countdown').innerHTML = markup;
  } else if (elapsed < 0.55) { $('countdown').textContent = 'GO'; }
  else if ($('countdown').textContent) { $('countdown').textContent = ''; }
  if (feedbackType && now - lastFeedback > 650) $('judgment-label').style.opacity = Math.max(0, 1 - (now - lastFeedback - 650) / 250);
  if (now - uiTime > 80) {
    uiTime = now;
    if (multiGame && state === 'playing') multiplayer.stats(session);
    const duration = testRange ? testRange.to - testRange.from : activeTrack.duration;
    $('play-elapsed').textContent = formatTime(Math.min(elapsed, duration));
    $('play-progress').style.width = `${clamp(elapsed / duration * 100, 0, 100, 0)}%`;
  }
}

for (const button of document.querySelectorAll('button[data-key-count]')) button.addEventListener('click', () => {
  if (state !== 'menu' || button.disabled) return;
  settings.keyCount = Number(button.dataset.keyCount);
  updateSettings();
});
$('start-button').addEventListener('click', start);
$('retry-button').addEventListener('click', () => multiplayer.inRoom ? multiplayer.replay() : start({ test: Boolean(testRange), testPosition: testRange?.position }));
$('return-button').addEventListener('click', menu);
$('preview-button').addEventListener('click', preview);
$('pause-button').addEventListener('click', pause);
$('resume-button').addEventListener('click', resume);
$('quit-button').addEventListener('click', menu);
$('pause-dialog').addEventListener('cancel', event => { event.preventDefault(); resume(); });
$('track-previous').addEventListener('click', () => stepTrack(-1));
$('track-next').addEventListener('click', () => stepTrack(1));
for (const track of BUILTIN_TRACKS) $(track.buttonId).addEventListener('click', () => selectTrack(track));
$('personal-remove').addEventListener('click', () => {
  if (state !== 'menu' || !personalTrack) return;
  const previous = personalTrack;
  if (activeTrack.personal) selectTrack(BUILTIN_TRACKS[0]);
  personalTrack = null; personalMusic.current = null;
  $('personal-track').remove(); audio.removeBuffer(previous.id);
  $('personal-current').textContent = '내 음악으로 플레이';
  $('personal-calibrate').hidden = true; $('personal-remove').hidden = true;
  updateTrack();
});

for (const button of document.querySelectorAll('[data-difficulty]')) button.addEventListener('click', () => {
  if (state !== 'menu') return;
  settings.difficulty = button.dataset.difficulty;
  updateSettings();
});
for (const [id, amount] of [['speed-minus', -0.5], ['speed-plus', 0.5]]) $(id).addEventListener('click', () => {
  settings.speed = clamp(settings.speed + amount, 1, 6, 3);
  updateSettings();
});
for (const [id, field, multiplier] of [['volume-input', 'volume', 0.01], ['lobby-volume-input', 'lobbyVolume', 0.01], ['effects-volume-input', 'effectsVolume', 0.01], ['combo-volume-input', 'comboVolume', 0.01], ['effect-intensity-input', 'effectIntensity', 0.01], ['speed-input', 'speed', 1], ['offset-input', 'offset', 1]]) $(id).addEventListener('input', event => {
  settings[field] = Number(event.target.value) * multiplier;
  updateSettings();
});
const comboPreviewButtons = [...document.querySelectorAll('[data-combo-preview]')];
for (const button of comboPreviewButtons) button.addEventListener('click', async () => {
  comboPreviewButtons.forEach(button => { button.disabled = true; });
  syncMenuMusic();
  try {
    await audio.prepareFeedback();
    if (!$('settings-dialog').open || !['menu', 'result'].includes(state)) return;
    if (settings.comboVolume <= 0) { toast('콤보 효과음 볼륨을 올리면 들을 수 있어요.'); return; }
    audio.stopFeedback();
    audio.playCombo(button.dataset.comboPreview, { preview: true });
  } catch (error) { toast(error.message); }
  finally { comboPreviewButtons.forEach(button => { button.disabled = false; }); }
});
$('hit-preview-button').addEventListener('click', async () => {
  const button = $('hit-preview-button');
  button.disabled = true;
  try {
    await audio.initContext();
    if (!$('settings-dialog').open || !['menu', 'result'].includes(state)) return;
    if (settings.effectsVolume <= 0) { toast('타격음 볼륨을 올리면 들을 수 있어요.'); return; }
    audio.hit(0, 'perfect');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
for (const id of ['settings-dialog', 'help-dialog']) $(id).addEventListener('close', () => { audio.stopFeedback(); syncMenuMusic(); });
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) clearEffects(); });
for (const id of ['settings-button', 'sync-button']) $(id).addEventListener('click', () => { $('settings-dialog').showModal(); syncMenuMusic(); });
$('help-button').addEventListener('click', () => { $('help-dialog').showModal(); syncMenuMusic(); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
for (const dialog of [$('settings-dialog'), $('help-dialog')]) dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
});

window.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if ($('settings-dialog').open || $('help-dialog').open || $('personal-dialog').open || $('multi-dialog').open) return;
  // Keep native slider/text editing keys; song navigation only operates in the menu.
  if (state === 'menu' && ['ArrowLeft', 'ArrowRight'].includes(event.code) && !event.target.closest('input, select, textarea, [contenteditable="true"]')) {
    event.preventDefault();
    stepTrack(event.code === 'ArrowRight' ? 1 : -1, true);
    return;
  }
  if (state === 'menu' && event.code === 'Enter' && event.target.closest('[data-disc-card][data-position="0"]')) {
    event.preventDefault(); start(); return;
  }
  const lane = inputKeys().indexOf(event.code);
  if (lane >= 0 && (state === 'playing' || state === 'paused' && session.activeHolds.has(lane))) {
    event.preventDefault();
    const timestamp = Math.abs(event.timeStamp - performance.now()) < 1000 ? event.timeStamp : performance.now();
    press(lane, event.code, timestamp);
  } else if (event.code === 'Escape' && state === 'playing') {
    event.preventDefault(); pause();
  } else if (event.code === 'Enter' && state === 'paused') {
    event.preventDefault(); resume();
  } else if (event.code === 'Enter' && !event.target.closest('button, input, select, textarea, a')) {
    if (state === 'menu' || state === 'result') { event.preventDefault(); start(); }
  }
});
window.addEventListener('keyup', event => {
  const lane = inputKeys().indexOf(event.code);
  if (lane >= 0) release(lane, event.code, inputTimestamp(event));
  for (const token of [...held]) if (token.startsWith('recovery-') && token.endsWith(`-${event.code}`)) release(Number(token.split('-')[1]), token, inputTimestamp(event));
});
function inputTimestamp(event) { return Math.abs(event.timeStamp - performance.now()) < 1000 ? event.timeStamp : performance.now(); }
function bindLaneControl(button, lane) {
  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); button.setPointerCapture(event.pointerId);
    press(lane, `pointer-${lane}-${event.pointerId}`, inputTimestamp(event));
  });
  if (button.dataset.holdLane !== undefined) button.addEventListener('keydown', event => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    if (!event.repeat) press(lane, `recovery-${lane}-Space`, inputTimestamp(event));
  });
}
function bindLaneControls() {
for (const button of laneButtons) {
  const lane = Number(button.dataset.lane);
  bindLaneControl(button, lane);
  // Assistive technology can activate the lane buttons without a pointer.
  button.addEventListener('click', event => {
    if (event.detail !== 0) return;
    const token = `accessible-${lane}`;
    press(lane, token); release(lane, token);
  });
}
}
// Recovery buttons can lose capture when their dialog closes. The physical
// pointerup/cancel still releases ownership, even outside the original button.
for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, event => {
  for (const token of [...held]) if (token.startsWith('pointer-') && token.endsWith(`-${event.pointerId}`)) release(Number(token.split('-')[1]), token, inputTimestamp(event));
});
window.addEventListener('blur', () => { clearHeld(); if (state === 'playing' && !multiGame) pause(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearHeld(); if (state === 'playing') pause(); }
  syncMenuMusic();
});
$('lobby-toggle').addEventListener('click', () => {
  if (selectedPreview.track) { preview(); return; }
  settings.lobbyEnabled = lobby.toggle();
  write('pulse-shift-settings', settings);
});
// Autoplay is unlocked by a real interaction, never by a synthetic click or timer.
window.addEventListener('click', event => {
  if (!event.isTrusted || state !== 'menu') return;
  selectedPreview.unlock();
  if (!event.target.closest('#lobby-toggle')) lobby.unlock();
}, { capture: true });
window.addEventListener('keydown', event => {
  if (!event.isTrusted || state !== 'menu' || event.repeat || event.metaKey || event.ctrlKey || event.altKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  selectedPreview.unlock();
  if (!event.target.closest('#lobby-toggle')) lobby.unlock();
}, { capture: true });
window.addEventListener('pagehide', () => { personalMusic.cancel(); selectedPreview.invalidate(); audio.stopLobby(); audio.stop(); });
if (new URLSearchParams(location.search).get('help') === '1') $('help-dialog').showModal();
updateTrack();
screen('menu');
requestAnimationFrame(frame);
