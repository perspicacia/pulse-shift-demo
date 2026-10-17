import { synthesize } from './synth.js';
import { synthesizeTidal } from './synth-tidal.js';
import { synthesizeAstral } from './synth-astral.js';
import { synthesizePrism } from './synth-prism.js';
import { synthesizeBloom } from './synth-bloom.js';
self.onmessage = ({ data }) => {
  try {
    const renderers = { afterglow: synthesize, 'tidal-circuit': synthesizeTidal, 'astral-veil': synthesizeAstral, 'prism-rush': synthesizePrism, 'neon-bloom': synthesizeBloom }, trackId = data.trackId || 'afterglow';
    if (!Object.hasOwn(renderers, trackId)) throw new Error('선택한 곡을 찾지 못했어요. 곡을 다시 선택해주세요.');
    const result = renderers[trackId]();
    self.postMessage(result, [result.left.buffer, result.right.buffer]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
