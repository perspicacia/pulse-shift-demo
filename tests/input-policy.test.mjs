import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, WINDOWS } from '../src/game.js';
import { BUILTIN_TRACKS } from '../src/tracks.js';
import { chartFor, sixKeyDifficulties } from '../src/modes.js';

test('empty presses break combo without changing chart counts, points or accuracy', () => {
  const s = new Session('normal', [{time:1,lane:0},{time:2,lane:1},{time:3,lane:0}]);
  s.hit(0,1);
  const before={score:s.score,accuracy:s.accuracy,counts:{...s.counts}};
  for (const [lane,time] of [[2,1.01],[1,1.5],[0,1.02]]) {
    const event=s.hit(lane,time);
    assert.equal(event.type,'empty');assert.equal(event.comboMilestone,0);
    assert.equal(s.combo,0);assert.equal(s.score,before.score);assert.equal(s.accuracy,before.accuracy);assert.deepEqual(s.counts,before.counts);
  }
  assert.equal(s.emptyPresses,3);assert.equal(s.maxCombo,1);
  s.hit(1,2);s.hit(0,3);
  assert.equal(s.score,1000000);assert.equal(s.accuracy,100);
  assert.equal(s.fullCombo,false);assert.equal(s.maxCombo,2);
});

test('lead-in, completed chart tail, and empty charts do not penalize input', () => {
  const s = new Session('normal',[{time:1,lane:0},{time:2,lane:1}]);
  for(const t of [-3,0,.859])assert.equal(s.hit(3,t),null);
  assert.equal(s.emptyPresses,0);
  assert.equal(s.hit(0,1-WINDOWS.good/1000).type,'good');
  assert.equal(s.hit(1,2+WINDOWS.good/1000).type,'good');
  for(const t of [2.14,2.15,3])assert.equal(s.hit(3,t),null);
  assert.equal(s.emptyPresses,0);assert.equal(s.fullCombo,true);assert.equal(s.combo,2);
  const empty=new Session('easy',[]);assert.equal(empty.hit(0,1),null);assert.equal(empty.emptyPresses,0);assert.equal(empty.fullCombo,false);
});

test('simultaneous notes accept either lane order and every valid judgment maintains combo', () => {
  for(const lanes of [[0,1],[1,0]]) {
    const s=new Session('normal',[{time:1,lane:0},{time:1,lane:1},{time:2,lane:2},{time:3,lane:3}]);
    for(const lane of lanes)assert.equal(s.hit(lane,1).type,'perfect');
    assert.equal(s.hit(2,2.07).type,'great');assert.equal(s.hit(3,3.1).type,'good');
    assert.equal(s.emptyPresses,0);assert.equal(s.combo,4);assert.equal(s.fullCombo,true);
  }
});

test('an input between frames can expire a note and break combo without duplicate MISS counts', () => {
  const s=new Session('normal',[{time:1,lane:0},{time:2,lane:1},{time:3,lane:0}]);
  s.hit(0,1);assert.equal(s.hit(3,2.141).type,'empty');
  assert.equal(s.counts.miss,1);assert.equal(s.combo,0);
  assert.deepEqual(s.expire(2.15),[]);assert.equal(s.counts.miss,1);
});

test('empty presses cannot repeat a rewarded combo milestone and retry clears the policy state', () => {
  const chart=Array.from({length:25},(_,i)=>({time:i+1,lane:0})),s=new Session('normal',chart),rewards=[];
  for(const note of chart){const e=s.hit(0,note.time);if(e.comboMilestone)rewards.push(e.comboMilestone);if(note.time===10)s.hit(1,10.01)}
  assert.deepEqual(rewards,[10]);assert.equal(s.emptyPresses,1);
  const retry=new Session('normal',chart);assert.equal(retry.emptyPresses,0);assert.equal(retry.combo,0);assert.equal(retry.nextComboMilestone,10);
});

for(const track of BUILTIN_TRACKS)for(const keys of [4,6])for(const difficulty of keys===4?['easy','normal','hard']:sixKeyDifficulties(track.id)) {
  test(`${track.id} ${keys}k ${difficulty}: perfect inputs are unchanged; all-lane spam cannot full-combo`,()=>{
    const chart=chartFor(track,keys,difficulty),perfect=new Session(difficulty,chart);
    for(const note of chart)assert.equal(perfect.hit(note.lane,note.time).type,'perfect');
    assert.equal(perfect.score,1000000);assert.equal(perfect.accuracy,100);assert.equal(perfect.combo,chart.length);assert.equal(perfect.fullCombo,true);
    for(const phase of [0,.05,.1,.15]){
      const spam=new Session(difficulty,chart);
      for(let i=0;i*.2+phase<=track.duration;i++)for(let lane=0;lane<keys;lane++)spam.hit(lane,i*.2+phase);
      spam.expire(track.duration+1);
      assert.ok(spam.emptyPresses>0);assert.ok(spam.maxCombo<chart.length);assert.equal(spam.fullCombo,false);
      assert.equal(spam.processed,chart.length);assert.equal(spam.counts.miss,0);
      // Combo-only policy preserves the previous note-weighted score formula.
      assert.equal(spam.score,Math.round((spam.counts.perfect+spam.counts.great*.7+spam.counts.good*.3)/chart.length*1000000));
    }
  });
}
