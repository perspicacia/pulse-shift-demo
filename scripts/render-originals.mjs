import { mkdir, writeFile } from 'node:fs/promises';
import { synthesizeSunset } from '../src/synth-sunset.js';
import { synthesizeMirage } from '../src/synth-mirage.js';

const renderers = { 'sunset-sip': synthesizeSunset, 'mirage-bloom': synthesizeMirage };
const requested = process.argv.slice(2);
const ids = requested.length ? requested : Object.keys(renderers);
for (const id of ids) if (!Object.hasOwn(renderers, id)) throw new Error(`Unknown original: ${id}`);
const destination = new URL('../artifacts/original-music/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const id of ids) {
  const { left, right, sampleRate } = renderers[id]();
  const wav = Buffer.alloc(44 + left.length * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  let peak = 0, power = 0;
  for (let i = 0; i < left.length; i++) {
    for (const value of [left[i], right[i]]) {
      if (!Number.isFinite(value) || Math.abs(value) > 1) throw new Error(`Invalid PCM: ${id}`);
      peak = Math.max(peak, Math.abs(value)); power += value * value;
    }
    wav.writeInt16LE(Math.round(left[i] * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(right[i] * 32767), 46 + i * 4);
  }
  await writeFile(new URL(`${id}.wav`, destination), wav);
  console.log(`${id}: ${(left.length / sampleRate).toFixed(2)}s, peak ${peak.toFixed(3)}, RMS ${Math.sqrt(power / (left.length * 2)).toFixed(3)}`);
}
