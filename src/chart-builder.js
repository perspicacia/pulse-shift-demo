// Shared by the newer tracks: turn an authored score into a playable 4-key chart.
// Kicks and snares keep fixed hand anchors; everything else rotates across both
// hands, so every lane carries a fair share of notes at every level.
const ROTATION = [0, 2, 1, 3];

export function buildChart(score, { beat, voices, gapBeats, from, to, anchors = {}, chord = () => false, maxChord = 2 }) {
  const order = Object.fromEntries(voices.map((voice, index) => [voice, index]));
  const candidates = score.filter(event => Object.hasOwn(order, event.voice) && event.beat >= from && event.beat < to)
    .sort((a, b) => a.time - b.time || order[a.voice] - order[b.voice]);
  const notes = [], lastLane = Array(4).fill(-Infinity), turns = new Map();
  let previous = -Infinity, simultaneous = 0;
  for (const event of candidates) {
    const together = Math.abs(event.time - previous) < 1e-8;
    if (together ? simultaneous >= maxChord || !chord(event) : event.time - previous < gapBeats * beat - 1e-9) continue;
    const group = Object.hasOwn(anchors, event.voice) ? event.voice : 'rotation';
    const lanes = anchors[event.voice] ?? ROTATION, turn = turns.get(group) ?? 0;
    const start = lanes[turn % lanes.length];
    // Same-lane notes stay at least 200 ms apart; a chord partner takes the next free lane.
    const lane = Array.from({ length: 4 }, (_, i) => (start + i) % 4).find(value => event.time - lastLane[value] >= 0.2);
    if (lane === undefined) continue;
    turns.set(group, turn + 1);
    notes.push({ time: event.time, lane, id: notes.length, judged: false });
    lastLane[lane] = event.time;
    previous = event.time;
    simultaneous = together ? simultaneous + 1 : 1;
  }
  return notes;
}
