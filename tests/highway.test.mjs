import test from 'node:test';
import assert from 'node:assert/strict';
import { highwayGeometry, projectHighway, projectHold } from '../src/highway.js';

test('note centers meet their input lanes exactly at the hit time, in both key modes', () => {
  for (const [width, height] of [[343, 480], [800, 350], [1380, 720]]) {
    const road = highwayGeometry(width, height);
    const hit = projectHighway(road, 1);
    assert.equal(hit.y, height - 76);
    for (const count of [4, 6]) {
      for (let lane = 0; lane < count; lane++) {
        const noteCenter = hit.left + hit.width * (lane + .5) / count;
        const inputCenter = road.left + road.bottomWidth * (lane + .5) / count;
        assert.ok(Math.abs(noteCenter - inputCenter) < 1e-9);
      }
      assert.ok(hit.width / count >= 44, 'Input keys remain operable on the small viewport');
    }
  }
});

test('approaching notes stay ordered and reach the line only at the scheduled time', () => {
  const road = highwayGeometry(1100, 650);
  for (const speed of [1, 3, 6]) {
    const travel = 3.8 / speed;
    let previous = projectHighway(road, 0);
    for (let step = 1; step <= 100; step++) {
      const remaining = travel * (1 - step / 100);
      const point = projectHighway(road, 1 - remaining / travel);
      assert.ok(point.y > previous.y && point.width > previous.width);
      if (step < 100) assert.ok(point.y < road.hitY);
      else assert.equal(point.y, road.hitY);
      previous = point;
    }
  }
});

test('the highway remains centered and finite before and after the judgment line', () => {
  const road = highwayGeometry(343, 420);
  for (const progress of [-1, 0, .5, 1, 1.1, 2]) {
    const point = projectHighway(road, progress);
    assert.ok(Number.isFinite(point.y) && Number.isFinite(point.width));
    assert.ok(Math.abs(point.left + point.width / 2 - road.width / 2) < 1e-9);
  }
});


test('hold body projects a fixed active head and descending tail at every speed/viewport',()=>{
  for(const [w,h] of [[343,480],[800,350],[1380,720]])for(const speed of [1,3,6]){
    const road=highwayGeometry(w,h),note={time:1,endTime:2};
    const before=projectHold(road,note,.95,3.8/speed);assert.ok(before.tail.y<before.head.y);assert.ok(before.head.y<road.hitY);
    const active=projectHold(road,{...note,holding:true},1.5,3.8/speed);assert.equal(active.head.y,road.hitY);assert.ok(active.tail.y<active.head.y);
    const done=projectHold(road,{...note,holding:true},2,3.8/speed);assert.equal(done.head.y,done.tail.y);assert.equal(done.tail.y,road.hitY);
  }
});
