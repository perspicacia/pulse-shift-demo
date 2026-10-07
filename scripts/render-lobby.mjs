import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { mkdir, writeFile } from 'node:fs/promises';
import { synthesizeLobby } from '../src/synth-lobby.js';

if (!isMainThread) {
  const result = synthesizeLobby();
  parentPort.postMessage(result, [result.left.buffer, result.right.buffer]);
} else {
  const worker = new Worker(new URL(import.meta.url));
  const { left, right, sampleRate } = await new Promise((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => { if (code) reject(new Error(`Lobby renderer exited: ${code}`)); });
  });
  const wav = Buffer.alloc(44 + left.length * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < left.length; i++) {
    wav.writeInt16LE(Math.round(left[i] * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(right[i] * 32767), 46 + i * 4);
  }
  await mkdir(new URL('../assets/music/', import.meta.url), { recursive: true });
  await writeFile(new URL('../assets/music/neon-halo.wav', import.meta.url), wav);
  console.log(`NEON HALO: ${left.length / sampleRate}s stereo WAV rendered.`);
}
