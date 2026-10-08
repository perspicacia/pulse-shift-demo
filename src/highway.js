// Rendering geometry only. The audio clock and judgment windows stay in app/game.
export function highwayGeometry(width, height) {
  const bottomWidth = width * (width < 700 ? 0.94 : 0.68);
  return { width, top: 30, hitY: height - 76, topWidth: width * 0.13, bottomWidth, left: (width - bottomWidth) / 2 };
}

export function projectHighway(road, progress) {
  // A vanishing-point projection: near notes grow and move faster, reaching the
  // judgment line at progress=1 regardless of speed, viewport or lane count.
  const p = Math.max(0, Math.min(1.1, progress));
  const depth = p / (3 - 2 * p);
  const width = road.topWidth + (road.bottomWidth - road.topWidth) * depth;
  return { y: road.top + (road.hitY - road.top) * depth, width, left: (road.width - width) / 2 };
}

export function projectHold(road, note, time, travel) {
  const project = at => projectHighway(road, 1 - (at - time) / travel);
  return { head: project(note.holding ? Math.max(note.time, time) : note.time), tail: project(note.endTime) };
}

function polygon(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}

export function drawHighway(ctx, options) {
  const { width, height, time, now, speed, bpm, beatOffset, notes, firstNote, laneCount, noteColors, heldLanes, flashes, effects, intensity, reduced } = options;
  const road = highwayGeometry(width, height);
  const top = projectHighway(road, 0), bottom = projectHighway(road, 1);
  const travel = 3.8 / speed;
  const projectedTime = noteTime => projectHighway(road, 1 - (noteTime - time) / travel);
  const laneEdge = (point, lane) => point.left + point.width * lane / laneCount;
  ctx.clearRect(0, 0, width, height);

  for (let lane = 0; lane < laneCount; lane++) {
    const points = [[laneEdge(top, lane), top.y], [laneEdge(top, lane + 1), top.y], [laneEdge(bottom, lane + 1), bottom.y], [laneEdge(bottom, lane), bottom.y]];
    polygon(ctx, points);
    const surface = ctx.createLinearGradient(0, top.y, 0, bottom.y);
    surface.addColorStop(0, '#10132622');
    surface.addColorStop(1, lane % 2 ? '#0b1025d9' : '#151b32d9');
    ctx.fillStyle = surface; ctx.fill();
    const held = heldLanes[lane];
    const flash = !reduced && intensity > 0 ? Math.max(0, 1 - (now - flashes[lane]) / 220) * intensity : 0;
    if (held || flash > 0) {
      const glow = ctx.createLinearGradient(0, bottom.y - 220, 0, bottom.y);
      glow.addColorStop(0, `${noteColors[lane]}00`); glow.addColorStop(1, `${noteColors[lane]}99`);
      ctx.save(); ctx.clip(); ctx.globalAlpha = held ? 0.55 : flash * 0.5;
      ctx.fillStyle = glow; ctx.fillRect(0, bottom.y - 220, width, 220); ctx.restore();
    }
  }
  const rail = ctx.createLinearGradient(0, top.y, 0, bottom.y);
  rail.addColorStop(0, '#c7c9ff10'); rail.addColorStop(1, '#bccaff88');
  for (let lane = 0; lane <= laneCount; lane++) {
    ctx.strokeStyle = rail; ctx.lineWidth = lane === 0 || lane === laneCount ? 1.8 : 1;
    ctx.beginPath(); ctx.moveTo(laneEdge(top, lane), top.y); ctx.lineTo(laneEdge(bottom, lane), bottom.y); ctx.stroke();
  }

  const beatLength = 60 / bpm;
  const firstBeat = Math.max(0, Math.floor((time - beatOffset) / beatLength));
  for (let beat = firstBeat; beat < (time + travel - beatOffset) / beatLength + 1; beat++) {
    const beatTime = beat * beatLength + beatOffset;
    if (beatTime < time || beatTime > time + travel) continue;
    const point = projectedTime(beatTime);
    ctx.strokeStyle = beat % 4 === 0 ? '#b8cbff35' : '#a6b8eb16'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(point.left, point.y); ctx.lineTo(point.left + point.width, point.y); ctx.stroke();
  }

  // Far notes first, so nearer notes remain readable where their glow overlaps.
  let end = firstNote;
  while (end < notes.length && notes[end].time <= time + travel) end++;
  for (let i = end - 1; i >= firstNote; i--) {
    const note = notes[i];
    if (note.judged) continue;
    const hold = note.endTime === undefined ? null : projectHold(road, note, time, travel);
    const point = hold?.head ?? projectedTime(note.time);
    if (point.y > road.hitY + 14) continue;
    const scale = point.width / road.bottomWidth;
    const gap = Math.max(1.5, 5 * scale);
    const x = laneEdge(point, note.lane) + gap, noteWidth = point.width / laneCount - gap * 2;
    const thickness = Math.max(3, 10 * scale);
    ctx.save();
    if (hold) {
      const active = note.holding && !note.suspended;
      const tail = hold.tail, tailGap = Math.max(1.5, 5 * tail.width / road.bottomWidth);
      const tx = laneEdge(tail, note.lane) + tailGap, tw = tail.width / laneCount - 2 * tailGap;
      polygon(ctx, [[tx, tail.y], [tx + tw, tail.y], [x + noteWidth, point.y], [x, point.y]]);
      ctx.fillStyle = `${noteColors[note.lane]}${active ? 'b8' : '66'}`; ctx.fill();
      ctx.strokeStyle = active ? '#e8fbff' : noteColors[note.lane]; ctx.lineWidth = active ? 2 : 1; ctx.stroke();
      // A center spine and an outlined tail distinguish holds by shape too.
      ctx.strokeStyle = '#e8fbffcc'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tx + tw / 2, tail.y); ctx.lineTo(x + noteWidth / 2, point.y); ctx.stroke();
      if (note.endTime <= time + travel) {
        const tailHeight = Math.max(4, 9 * tail.width / road.bottomWidth);
        ctx.fillStyle = '#101326'; ctx.fillRect(tx, tail.y - tailHeight / 2, tw, tailHeight);
        ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 1.5; ctx.strokeRect(tx, tail.y - tailHeight / 2, tw, tailHeight);
      }
    }
    ctx.shadowColor = noteColors[note.lane]; ctx.shadowBlur = reduced || intensity <= 0 ? 0 : 12 * scale * intensity;
    ctx.fillStyle = noteColors[note.lane]; ctx.beginPath();
    ctx.roundRect(x, point.y - thickness / 2, noteWidth, thickness, Math.min(3, thickness / 2)); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffffffe8';
    ctx.fillRect(x + 1, point.y - thickness / 2 + 1, noteWidth - 2, Math.max(1, thickness * 0.36));
    ctx.restore();
  }

  const lineGlow = ctx.createLinearGradient(road.left, 0, road.left + road.bottomWidth, 0);
  lineGlow.addColorStop(0, '#82eaff'); lineGlow.addColorStop(0.5, '#e7deff'); lineGlow.addColorStop(1, '#b39aff');
  ctx.save(); ctx.strokeStyle = lineGlow;
  ctx.shadowColor = '#ac96ff'; ctx.shadowBlur = reduced || intensity <= 0 ? 0 : 18 * intensity;
  ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(road.left, road.hitY); ctx.lineTo(road.left + road.bottomWidth, road.hitY); ctx.stroke(); ctx.restore();
  ctx.save(); ctx.translate(road.left, 0);
  effects.draw(ctx, road.bottomWidth, road.hitY, now, intensity, reduced);
  ctx.restore();
}
