import test from 'node:test';
import assert from 'node:assert/strict';
import {Session, WINDOWS, HOLD_RELEASE_GRACE_MS} from '../src/game.js';
import {BUILTIN_TRACKS} from '../src/tracks.js';
import {chartFor, keysFor, modeRecordKey} from '../src/modes.js';
import {ASTRAL_BEAT, createAstralScore} from '../src/astral-score.js';
import {inputPlan, playChart} from '../scripts/qa-input-plan.mjs';
const single=()=>new Session('normal',[{time:1,endTime:2,lane:0}]);

test('a hold has one pending head and one final judgment, point, offset and combo',()=>{
  const s=single();assert.equal(s.hit(0,1).type,'hold');
  assert.equal(s.processed,0);assert.equal(s.score,0);assert.equal(s.combo,0);assert.equal(s.fullCombo,false);
  assert.equal(s.hit(0,1.02),null);assert.equal(s.emptyPresses,0);
  assert.deepEqual(s.expire(1.5),[]);assert.equal(s.notes[0].holding,true);
  assert.equal(s.expire(2)[0].type,'perfect');assert.equal(s.release(0,2.1),null);
  assert.deepEqual(s.expire(3),[]);assert.equal(s.processed,1);assert.equal(s.score,1000000);assert.equal(s.combo,1);assert.equal(s.fullCombo,true);assert.deepEqual(s.offsets,[0]);
});

test('hold heads keep every existing inclusive tap judgment boundary',()=>{
  for(const [ms,type] of [[-140,'good'],[-90,'great'],[-45,'perfect'],[45,'perfect'],[90,'great'],[140,'good']]){
    const s=single();assert.equal(s.hit(0,1+ms/1000).headType,type);assert.equal(s.release(0,2).type,type);assert.equal(s.counts[type],1);
  }
  const late=single();late.hit(0,1.140001);assert.equal(late.counts.miss,1);assert.equal(late.activeHolds.size,0);
  const early=single();early.hit(0,.859);early.expire(1.141);assert.equal(early.counts.miss,1);assert.equal(early.counts.perfect,0);
});

test('tail release accepts exactly 80ms early and any later release, earlier release fails once',()=>{
  for(const delta of [-.081,-.080001,-HOLD_RELEASE_GRACE_MS/1000,-.079,0,.05,1]){
    const s=single();s.hit(0,1);const success=delta>=-.08;
    assert.equal(s.release(0,2+delta).type,success?'perfect':'miss');
    assert.equal(s.release(0,2.1),null);assert.equal(s.processed,1);assert.equal(s.combo,success?1:0);
  }
});

test('early release and re-press cannot rescue a hold or create two scores',()=>{
  const s=new Session('normal',[{time:.5,lane:1},{time:1,endTime:2,lane:0},{time:3,lane:1}]);
  s.hit(1,.5);s.hit(0,1);assert.equal(s.release(0,1.2).type,'miss');assert.equal(s.combo,0);
  assert.equal(s.hit(0,1.22).type,'empty');assert.equal(s.counts.miss,1);assert.equal(s.activeHolds.size,0);
  s.hit(1,3);s.finish(4);assert.equal(s.processed,3);assert.equal(s.counts.perfect,2);assert.equal(s.maxCombo,1);
});

test('two holds and other-lane taps resolve independently in chronological order',()=>{
  const chart=[{time:1,endTime:3,lane:0},{time:1,endTime:2,lane:1},{time:1.5,lane:2},{time:2.5,lane:3}];
  const s=new Session('normal',chart);s.hit(1,1);s.hit(0,1);s.hit(2,1.5);
  assert.equal(s.release(1,2).type,'perfect');s.hit(3,2.5);s.expire(3);
  assert.equal(s.combo,4);assert.equal(s.emptyPresses,0);assert.equal(s.score,1000000);
  const missed=new Session('normal',chart);missed.hit(0,1);
  const events=missed.expire(3);assert.deepEqual(events.map(e=>e.type),['miss','miss','miss','perfect']);assert.equal(missed.combo,1);
});

test('holding a lane does not exempt fresh empty presses on other lanes or a missed next head',()=>{
  const s=new Session('normal',[{time:1,endTime:2,lane:0},{time:3,lane:0}]);
  s.hit(0,1);assert.equal(s.hit(2,1.5).type,'empty');s.expire(2);assert.equal(s.combo,1);s.expire(3.141);assert.equal(s.combo,0);assert.equal(s.counts.miss,1);
});

test('pause suspends every hold, requires each lane to be re-grabbed, and never grants free completion',()=>{
  const s=new Session('normal',[{time:1,endTime:2,lane:0},{time:1,endTime:3,lane:1}]);s.hit(0,1);s.hit(1,1);
  s.suspendHolds();assert.deepEqual(s.pendingHoldLanes,[0,1]);assert.deepEqual(s.expire(10),[]);assert.equal(s.processed,0);
  assert.equal(s.recoverHold(3),false);s.recoverHold(0);assert.deepEqual(s.pendingHoldLanes,[1]);
  s.recoverHold(0,false);assert.deepEqual(s.pendingHoldLanes,[0,1]);s.recoverHold(0);s.recoverHold(1);assert.deepEqual(s.pendingHoldLanes,[]);
  s.expire(3);assert.equal(s.processed,2);assert.equal(s.score,1000000);
});

test('song end settles an interrupted hold as MISS and retry has no held state',()=>{
  const s=single();s.hit(0,1);s.suspendHolds();s.finish(3);assert.equal(s.counts.miss,1);assert.equal(s.activeHolds.size,0);assert.equal(s.fullCombo,false);
  assert.deepEqual(s.finish(3),[]);const retry=single();assert.equal(retry.activeHolds.size,0);assert.equal(retry.score,0);assert.equal(retry.emptyPresses,0);
  assert.throws(()=>new Session('normal',[{time:1,endTime:1,lane:0}]),RangeError);
});

test('a pending tenth hold grants its combo reward only once at successful completion',()=>{
  const chart=[...Array.from({length:9},(_,i)=>({time:(i+1)/10,lane:1})),{time:1,endTime:2,lane:0}],s=new Session('normal',chart);
  for(const note of chart.slice(0,9))s.hit(note.lane,note.time);
  assert.equal(s.hit(0,1).comboMilestone,0);assert.equal(s.combo,9);assert.equal(s.counts.perfect,9);
  const event=s.expire(2)[0];assert.equal(event.comboMilestone,10);assert.equal(s.combo,10);assert.equal(s.counts.perfect,10);
  assert.equal(s.release(0,2.01),null);assert.deepEqual(s.expire(3),[]);assert.equal(s.events.filter(e=>e.comboMilestone).length,1);
});

test('only Astral LEVEL 2 six-key has eight musical holds with no lane/window or hand-cap conflict',()=>{
  const chart=chartFor(BUILTIN_TRACKS[2],6,'normal'),holds=chart.filter(n=>n.endTime),padTimes=new Set(createAstralScore().filter(e=>e.voice==='pad').map(e=>e.time));
  assert.equal(holds.length,8);assert.equal(chart.length,243);
  for(const hold of holds){
    assert.ok(padTimes.has(hold.time));assert.ok([1,2].some(beats=>Math.abs(hold.endTime-hold.time-beats*ASTRAL_BEAT)<1e-8));
    const next=chart.find(n=>n.lane===hold.lane&&n.time>hold.time);
    assert.ok(!next||next.time-WINDOWS.good/1000>hold.endTime);
  }
  for(const n of chart){const simultaneous=chart.filter(h=>h.endTime&&h.time<n.time&&h.endTime>n.time).length+chart.filter(h=>h.time===n.time).length;assert.ok(simultaneous<=2)}
  for(const track of BUILTIN_TRACKS)for(const keys of [4,6])for(const level of keys===4?['easy','normal','hard']:track.id==='afterglow'?['easy']:track.id==='astral-veil'?['normal','hard']:[]){
    if(track.id==='astral-veil'&&keys===6&&level==='normal')continue;assert.ok(chartFor(track,keys,level).every(n=>n.endTime===undefined));
  }
});

test('hold-aware autoplay sends real down/up actions and preserves the million-point oracle',()=>{
  const chart=chartFor(BUILTIN_TRACKS[2],6,'normal'),plan=inputPlan(chart,keysFor(6)),s=playChart(new Session('normal',chart),chart);
  assert.equal(plan.length,486);assert.equal(s.score,1000000);assert.equal(s.accuracy,100);assert.equal(s.combo,243);assert.equal(s.counts.perfect,243);assert.equal(s.fullCombo,true);
  for(const hold of chart.filter(n=>n.endTime)){const actions=plan.filter(a=>a.id===chart.indexOf(hold));assert.equal(actions[1].time,hold.endTime+.005)}
  assert.equal(modeRecordKey('astral-veil','normal',6),'astral-veil:6k:normal:hold-v1');assert.equal(modeRecordKey('astral-veil','normal',4),'astral-veil:4k:normal');
});
