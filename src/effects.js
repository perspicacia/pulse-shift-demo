const COLORS = { perfect: '#d5ff56', great: '#83e8f0', good: '#ffc984' };
const CONFETTI = ['#d5ff56', '#83e8f0', '#ffe19b', '#ff8fa3', '#ffffff'];

export class HitEffects {
  constructor() { this.clear(); }
  clear() { this.bursts = []; this.particles = []; this.celebration = null; }

  hit(lane, type, now, intensity, reduced, laneCount = 4) {
    if (reduced || intensity <= 0 || !COLORS[type]) return;
    const power = type === 'perfect' ? 1 : type === 'great' ? 0.8 : 0.55;
    const x = (lane + 0.5) / laneCount;
    this.bursts.push({ x, birth: now, color: COLORS[type], power });
    this.bursts = this.bursts.slice(-20);
    const count = Math.round((type === 'perfect' ? 24 : 14) * intensity);
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI * (0.08 + Math.random() * 0.84);
      const speed = (90 + Math.random() * 220) * power;
      this.particles.push({ x, y: 0, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, birth: now, life: 340 + Math.random() * 320, size: 2 + Math.random() * 3, color: i % 4 === 0 ? '#ffffff' : COLORS[type], star: i % 5 === 0 });
    }
    this.particles = this.particles.slice(-320);
  }

  celebrate(now, intensity, reduced) {
    if (reduced || intensity <= 0) return;
    this.celebration = { birth: now, intensity };
    for (let i = 0; i < Math.round(75 * intensity); i++) {
      const side = i % 2;
      this.particles.push({ x: side ? 0.98 : 0.02, y: -15, vx: (side ? -1 : 1) * (70 + Math.random() * 190), vy: -110 - Math.random() * 350, birth: now, life: 850 + Math.random() * 350, size: 3 + Math.random() * 4, color: CONFETTI[i % CONFETTI.length], star: i % 4 === 0 });
    }
    this.particles = this.particles.slice(-320);
  }

  star(ctx, x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x, y - size); ctx.lineTo(x + size * 0.3, y - size * 0.3);
    ctx.lineTo(x + size, y); ctx.lineTo(x + size * 0.3, y + size * 0.3);
    ctx.lineTo(x, y + size); ctx.lineTo(x - size * 0.3, y + size * 0.3);
    ctx.lineTo(x - size, y); ctx.lineTo(x - size * 0.3, y - size * 0.3);
    ctx.closePath(); ctx.fill();
  }

  draw(ctx, width, hitY, now, intensity, reduced) {
    if (reduced || intensity <= 0) { this.clear(); return; }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this.bursts = this.bursts.filter(burst => now - burst.birth < 420);
    for (const burst of this.bursts) {
      // A queued animation frame can predate a newly handled input.
      const age = Math.max(0, now - burst.birth) / 420, fade = (1 - age) ** 2 * intensity;
      const x = burst.x * width, radius = 12 + age * 72 * burst.power;
      const glow = ctx.createRadialGradient(x, hitY - 3, 0, x, hitY - 3, radius);
      glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.18, burst.color); glow.addColorStop(1, '#00000000');
      ctx.globalAlpha = fade * 0.75; ctx.fillStyle = glow;
      ctx.fillRect(x - radius, hitY - radius - 3, radius * 2, radius * 2);
      ctx.strokeStyle = burst.color; ctx.lineWidth = 2.5 * (1 - age) + 0.5; ctx.globalAlpha = fade;
      ctx.beginPath(); ctx.ellipse(x, hitY - 3, radius, radius * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffffff'; this.star(ctx, x, hitY - 4, (1 - age) * 22 * burst.power);
      if (age < 0.5) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
        for (let ray = 0; ray < 8; ray++) {
          const angle = ray * Math.PI / 4;
          ctx.beginPath(); ctx.moveTo(x + Math.cos(angle) * radius * 0.65, hitY - 3 + Math.sin(angle) * radius * 0.5);
          ctx.lineTo(x + Math.cos(angle) * radius * 1.25, hitY - 3 + Math.sin(angle) * radius * 0.9); ctx.stroke();
        }
      }
    }
    if (this.celebration) {
      const age = Math.max(0, now - this.celebration.birth) / 1000;
      if (age < 1.1) {
        ctx.globalAlpha = (1 - age / 1.1) * intensity * 0.55;
        const halo = ctx.createRadialGradient(width / 2, hitY, 0, width / 2, hitY, width * 0.65);
        halo.addColorStop(0, '#ffe19b55'); halo.addColorStop(1, '#ffe19b00');
        ctx.fillStyle = halo; ctx.fillRect(0, hitY - width * 0.65, width, width * 0.65);
      } else this.celebration = null;
    }
    this.particles = this.particles.filter(p => now - p.birth < p.life);
    for (const p of this.particles) {
      const age = Math.max(0, now - p.birth) / 1000;
      const x = p.x * width + p.vx * age, y = hitY + p.y + p.vy * age + 160 * age * age;
      ctx.globalAlpha = (1 - age * 1000 / p.life) * intensity;
      ctx.fillStyle = p.color;
      if (p.star) this.star(ctx, x, y, p.size * 1.3);
      else { ctx.beginPath(); ctx.arc(x, y, p.size * 0.6, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
}
