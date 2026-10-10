import { SONG, DURATION, DIFFICULTIES, createChart } from './game.js';
import { TIDAL_SONG, TIDAL_DURATION, createTidalChart } from './tidal-score.js';
import { ASTRAL_SONG, ASTRAL_DURATION, createAstralChart } from './astral-score.js';
import { SUNSET_SONG, SUNSET_DURATION, createSunsetChart } from './sunset-score.js';
import { MIRAGE_SONG, MIRAGE_DURATION, createMirageChart } from './mirage-score.js';

const charts = create => Object.fromEntries(Object.keys(DIFFICULTIES).map(mode => [mode, create(mode)]));
export const BUILTIN_TRACKS = [
  { ...SONG, id: 'afterglow', number: '001', buttonId: 'builtin-track', duration: DURATION, beatOffset: 0, cover: './assets/afterglow.svg', coverTitle: 'AFTER<br>GLOW', subtitle: '01 / FEEL THE RESONANCE', description: '끝나지 않는 잔광, 다시 시작되는 비트.\n신스의 파동 위로 당신만의 리듬을 새겨보세요.', previewBeat: 16, charts: charts(createChart) },
  { ...TIDAL_SONG, number: '002', buttonId: 'tidal-track', duration: TIDAL_DURATION, beatOffset: 0, cover: './assets/tidal-circuit.svg', coverTitle: 'TIDAL<br>CIRCUIT', subtitle: '02 / FOLLOW THE UNDERTOW', description: '깊은 베이스와 엇박의 흐름, 파도처럼 번지는 신스.\n몽환적인 그루브 위로 새로운 리듬을 새겨보세요.', previewBeat: 32, charts: charts(createTidalChart) },
  { ...ASTRAL_SONG, number: '003', buttonId: 'astral-track', duration: ASTRAL_DURATION, beatOffset: 0, cover: './assets/astral-veil.svg', coverTitle: 'ASTRAL<br>VEIL', subtitle: '03 / BEYOND THE ORBIT', description: '묵직한 전자 비트 너머, 별빛처럼 번지는 신스와 합창.\n우주를 떠도는 파동 위로 새로운 궤도를 그려보세요.', previewBeat: 80, charts: charts(createAstralChart) },
  { ...SUNSET_SONG, number: '004', buttonId: 'sunset-track', duration: SUNSET_DURATION, beatOffset: 0, cover: './assets/sunset-sip.svg', discCover: './assets/sunset-sip-disc.svg', coverTitle: 'SUNSET<br>SIP', subtitle: '04 / SLOW DOWN, DRIFT ON', description: '따뜻한 전자피아노와 느긋하게 흔들리는 비트.\n해 질 녘 바닷가에서 한 모금 쉬어가는 리듬.', previewBeat: 24, charts: charts(createSunsetChart) },
  { ...MIRAGE_SONG, number: '005', buttonId: 'mirage-track', duration: MIRAGE_DURATION, beatOffset: 0, cover: './assets/mirage-bloom.svg', discCover: './assets/mirage-bloom-disc.svg', coverTitle: 'MIRAGE<br>BLOOM', subtitle: '05 / FOLLOW THE HIDDEN GARDEN', description: '숨결 같은 플루트와 둥근 손 타악, 안개처럼 번지는 패드.\n몽환적인 선율이 피어나는 새로운 음악의 정원.', previewBeat: 64, charts: charts(createMirageChart) },
];
