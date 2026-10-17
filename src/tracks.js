import { SONG, DURATION, DIFFICULTIES, createChart } from './game.js';
import { TIDAL_SONG, TIDAL_DURATION, createTidalChart } from './tidal-score.js';
import { ASTRAL_SONG, ASTRAL_DURATION, createAstralChart } from './astral-score.js';
import { PRISM_SONG, PRISM_DURATION, createPrismChart } from './prism-score.js';
import { BLOOM_SONG, BLOOM_DURATION, createBloomChart } from './bloom-score.js';

const charts = create => Object.fromEntries(Object.keys(DIFFICULTIES).map(mode => [mode, create(mode)]));
export const BUILTIN_TRACKS = [
  { ...SONG, id: 'afterglow', number: '001', buttonId: 'builtin-track', duration: DURATION, beatOffset: 0, cover: './assets/afterglow.svg', coverTitle: 'AFTER<br>GLOW', subtitle: '01 / FEEL THE RESONANCE', description: '끝나지 않는 잔광, 다시 시작되는 비트.\n신스의 파동 위로 당신만의 리듬을 새겨보세요.', previewBeat: 16, charts: charts(createChart) },
  { ...TIDAL_SONG, number: '002', buttonId: 'tidal-track', duration: TIDAL_DURATION, beatOffset: 0, cover: './assets/tidal-circuit.svg', coverTitle: 'TIDAL<br>CIRCUIT', subtitle: '02 / FOLLOW THE UNDERTOW', description: '깊은 베이스와 엇박의 흐름, 파도처럼 번지는 신스.\n몽환적인 그루브 위로 새로운 리듬을 새겨보세요.', previewBeat: 32, charts: charts(createTidalChart) },
  { ...ASTRAL_SONG, number: '003', buttonId: 'astral-track', duration: ASTRAL_DURATION, beatOffset: 0, cover: './assets/astral-veil.svg', coverTitle: 'ASTRAL<br>VEIL', subtitle: '03 / BEYOND THE ORBIT', description: '묵직한 전자 비트 너머, 별빛처럼 번지는 신스와 합창.\n우주를 떠도는 파동 위로 새로운 궤도를 그려보세요.', previewBeat: 80, charts: charts(createAstralChart) },
  { ...PRISM_SONG, number: '004', buttonId: 'prism-track', duration: PRISM_DURATION, beatOffset: 0, cover: './assets/prism-rush.svg', coverTitle: 'PRISM<br>RUSH', subtitle: '04 / SPLIT THE LIGHT', description: '쉼 없이 구르는 브레이크비트, 빛처럼 갈라지는 코드.\n172 BPM의 속도 위로 손끝을 밀어붙여 보세요.', previewBeat: 112, charts: charts(createPrismChart) },
  { ...BLOOM_SONG, number: '005', buttonId: 'bloom-track', duration: BLOOM_DURATION, beatOffset: 0, cover: './assets/neon-bloom.svg', coverTitle: 'NEON<br>BLOOM', subtitle: '05 / DANCE TILL DAWN', description: '통통 튀는 베이스와 반짝이는 일렉트릭 피아노.\n석양 아래 디스코 그루브에 몸을 맡겨보세요.', previewBeat: 32, charts: charts(createBloomChart) },
];
