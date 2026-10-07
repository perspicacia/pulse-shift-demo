import test from 'node:test';
import assert from 'node:assert/strict';
import { HitEffects } from '../src/effects.js';

test('an older animation-frame timestamp cannot create negative radii or reverse new hit effects', () => {
  const gradients = [], alpha = [];
  const ctx = new Proxy({
    createRadialGradient(...values) {
      assert.ok(values.every(Number.isFinite));
      assert.ok(values[2] >= 0 && values[5] >= 0, 'Canvas rejects negative radii');
      gradients.push(values);
      return { addColorStop() {} };
    },
    ellipse(x, y, rx, ry) { assert.ok(rx >= 0 && ry >= 0); },
    arc(x, y, radius) { assert.ok(radius >= 0); },
  }, {
    get(target, key) { return key in target ? target[key] : () => {}; },
    set(target, key, value) {
      if (key === 'globalAlpha') { assert.ok(value >= 0 && value <= 1); alpha.push(value); }
      target[key] = value; return true;
    },
  });
  const effects = new HitEffects();
  effects.hit(0, 'perfect', 1000, 1, false);
  effects.celebrate(1000, 1, false);
  effects.draw(ctx, 600, 700, 850, 1, false);
  assert.equal(gradients[0][5], 12, 'New effect starts at its initial size');
  effects.draw(ctx, 600, 700, 1000, 1, false);
  effects.draw(ctx, 600, 700, 1419, 1, false);
  effects.draw(ctx, 600, 700, 2201, 1, false);
  assert.equal(effects.bursts.length, 0); assert.equal(effects.particles.length, 0);
  assert.equal(effects.celebration, null); assert.ok(alpha.length > 0);
});
