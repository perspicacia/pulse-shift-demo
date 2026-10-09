import { extractFeatures, analyzeFeatures } from './personal-analysis.js';
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ stage: 'features' });
    const features = extractFeatures(data.channels, data.sampleRate);
    self.postMessage({ stage: 'beats' });
    self.postMessage({ result: analyzeFeatures(features) });
  } catch (error) { self.postMessage({ error: error.message }); }
};
