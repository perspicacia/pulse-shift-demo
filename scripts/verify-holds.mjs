import {inputPlan} from './qa-input-plan.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'artifacts/hold-qa',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={startedAt:new Date().toISOString(),limitations:['Fresh isolated muted headless Chrome. CDP keyboard/mouse cases are browser inputs, not physical keyboard measurements. Full songs use page-scheduled authored down/up actions through existing handlers, without changing charts, judgment windows, score or event timestamps. Two simultaneous holds are unit-tested; the authored chart combines single holds with other-lane taps. Device acoustics, Bluetooth/display delay and actual mobile touch remain unmeasured.'],cases:[]};
const hook=`window.audit={events:[],inputs:[],frames:[],judgments:[],longTasks:[]};for(const type of ['keydown','keyup','pointerdown','pointerup','click'])window.addEventListener(type,e=>{if(document.body.dataset.screen==='game')window.audit.events.push({type,code:e.code,repeat:e.repeat,trusted:e.isTrusted,stamp:e.timeStamp,handlerAt:performance.now()})},true);new PerformanceObserver(list=>audit.longTasks.push(...list.getEntries().map(e=>({at:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});`;
let chrome,server,profile;const connections=[];
function attach(socketUrl) {
  const socket=new WebSocket(socketUrl), pending=new Map();let seq=0;
  const ready=new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true})});
  const evidence=[];
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}else if(['Runtime.exceptionThrown','Log.entryAdded'].includes(m.method))evidence.push(m)});
  const send=async(method,params={})=>{await ready;return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})};
  connections.push(socket);
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  const until=async(expression,timeout=30000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await pause(30)}throw Error('Timeout: '+expression)};
  const click=async selector=>{await until(`document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);const p=await evaluate(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});let r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})};
  const key=async(code,type='tap',repeat=false)=>{const k=code.startsWith('Key')?code.slice(3).toLowerCase():code==='Space'?' ':code,vk=code.startsWith('Key')?code.charCodeAt(3):code==='Escape'?27:code==='Space'?32:13;const p={key:k,code,windowsVirtualKeyCode:vk};if(type!=='up')await send('Input.dispatchKeyEvent',{type:'keyDown',autoRepeat:repeat,...p});if(type!=='down')await send('Input.dispatchKeyEvent',{type:'keyUp',...p})};
  return {send,evaluate,until,click,key,evidence};
}
async function setup(c,url) {
  await Promise.all([c.send('Page.enable'),c.send('Runtime.enable'),c.send('Log.enable')]);
  await c.send('Emulation.setDeviceMetricsOverride',{width:1000,height:760,deviceScaleFactor:1,mobile:false});
  await c.send('Page.addScriptToEvaluateOnNewDocument',{source:hook});
  await c.send('Page.navigate',{url});await c.until(`document.body.dataset.screen==='menu'`);
  await c.evaluate(`Promise.all([import('./src/game.js'),import('./src/audio.js')]).then(([{Session},{AudioEngine}])=>{
    const release=Session.prototype.release,hit=Session.prototype.hit,resolve=Session.prototype.resolve,expire=Session.prototype.expire,time=AudioEngine.prototype.time,play=AudioEngine.prototype.play;
    Session.prototype.expire=function(t){audit.session=this;return expire.call(this,t)};
    Session.prototype.release=function(lane,t){let r=release.call(this,lane,t);audit.inputs.push({release:true,lane,time:t,result:r,at:performance.now()});return r};
    Session.prototype.hit=function(lane,t){audit.session=this;let r=hit.call(this,lane,t);audit.inputs.push({lane,time:t,result:r,at:performance.now()});return r};
    Session.prototype.resolve=function(note,type,delta){audit.session=this;let r=resolve.call(this,note,type,delta);if(r)audit.judgments.push({...r,id:note.id,at:performance.now()});return r};
    AudioEngine.prototype.play=function(...a){audit.audio=this;return play.apply(this,a)};
    AudioEngine.prototype.time=function(t){let result=time.call(this,t);if(this===audit.audio&&this.source&&t===undefined&&document.body.dataset.screen==='game'&&this.context.state==='running'){let p=performance.now(),s=this.context.getOutputTimestamp();audit.frames.push({at:p,time:result,contextTime:this.context.currentTime,stamp:s,baseLatency:this.context.baseLatency,outputLatency:this.context.outputLatency})}return result};
  })`);
}
async function configure(c,track,keys,difficulty) {
  if(track!=='afterglow')await c.click(`[data-disc-card][data-builtin-track="${track}"]`);
  await c.click(`[data-key-count="${keys}"]`);await c.click(`[data-difficulty="${difficulty}"]`);
  await c.click('#start-button');await c.until(`document.body.dataset.screen==='game'&&!!audit.audio`);
}
const snapshot=c=>c.evaluate(`(()=>{let s=audit.session;return{score:s?.score,combo:s?.combo,maxCombo:s?.maxCombo,counts:s?.counts,emptyPresses:s?.emptyPresses,comboLabel:document.getElementById('combo-label').textContent,maxComboLabel:document.getElementById('live-max-combo').textContent,judgment:document.getElementById('judgment-label').textContent,inputs:audit.inputs.length,trustedEvents:audit.events.filter(e=>e.type==='keydown'&&e.trusted).length}})()`);
async function waitSong(c,time){while(await c.evaluate(`audit.audio.time()`)<time)await pause(5)}
try {
  const port=Number(process.env.QA_PORT||4198),url=process.env.QA_URL||`http://127.0.0.1:${port}/`;
  report.url=url;
  if(!process.env.QA_URL)server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},stdio:['ignore','ignore','pipe']});
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch(url)).ok;if(ready)break}catch{}await pause(40)}assert.ok(ready);
  const candidates=process.env.CHROME_PATH?[process.env.CHROME_PATH]:['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'];
  let executable;for(const candidate of candidates){try{await access(candidate);executable=candidate;break}catch{}}
  assert.ok(executable,'Installed Chrome/Chromium required; set CHROME_PATH. Nothing is installed automatically.');
  profile=await mkdtemp(join(tmpdir(),'pulse-feedback-'));
  chrome=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-sync','--disable-extensions','--mute-audio','about:blank'],{stdio:['ignore','ignore','pipe']});
  let debugPort;for(let i=0;i<100;i++){try{debugPort=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break}catch{}if(chrome.exitCode!==null)throw Error('Chrome blocked');await pause(50)}assert.ok(debugPort);
  const targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const control=attach(targets.find(t=>t.type==='page').webSocketDebuggerUrl);

  const c=control;
  report.browser=await c.send('Browser.getVersion');await setup(c,url);await configure(c,'astral-veil',6,'normal');
  const chart=await c.evaluate(`import('./src/modes.js').then(m=>m.createAstralSixKeyNormalChart())`),holds=chart.map((n,id)=>({...n,id})).filter(n=>n.endTime),keys=['KeyS','KeyD','KeyF','KeyJ','KeyK','KeyL'];
  assert.equal(holds.length,8);
  async function shot(name){const r=await c.send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,name+'.png'),Buffer.from(r.data,'base64'))}
  const noteState=h=>c.evaluate(`(()=>{let s=audit.session,n=s.notes[${h.id}];return{note:{...n},counts:{...s.counts},score:s.score,combo:s.combo,empty:s.emptyPresses,pending:s.pendingHoldLanes,audioState:audit.audio.context.state,dialog:document.getElementById('pause-dialog').open,judgments:audit.judgments.filter(e=>e.id===${h.id}),pressed:[...document.querySelectorAll('[data-lane].pressed')].map(b=>Number(b.dataset.lane))}})()`);
  async function schedule(notes){const actions=inputPlan(notes,keys);await c.evaluate(`(()=>{const plan=${JSON.stringify(actions)};let i=0;audit.planned=[];function tick(){if(document.body.dataset.screen!=='game')return;if(audit.audio.context.state==='running'&&!document.getElementById('pause-dialog').open){const time=audit.audio.time(performance.now());while(i<plan.length&&time>=plan[i].time){const a=plan[i++];window.dispatchEvent(new KeyboardEvent(a.type,{code:a.code,key:a.code.slice(3).toLowerCase(),bubbles:true,cancelable:true}));audit.planned.push({planned:a.time,actual:time,type:a.type,code:a.code})}}if(i<plan.length)setTimeout(tick,4)}tick()})()`)}
  async function record(name,h){const state=await noteState(h);report.cases.push({name,state});console.log('HOLD_CASE',name,JSON.stringify({counts:state.counts,pending:state.pending,judgments:state.judgments.map(j=>j.type)}));return state}
  const mouse=async(selector,down)=>{let point=selector?await c.evaluate(`(()=>{let r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`):{x:10,y:10};await c.send('Input.dispatchMouseEvent',{type:down?'mousePressed':'mouseReleased',button:'left',buttons:down?1:0,clickCount:1,...point})};
  await schedule(chart.filter(n=>!n.endTime));
  const first=holds[0],code=keys[first.lane];await waitSong(c,first.time-.32);await shot('01-hold-approach');await waitSong(c,first.time);await c.key(code,'down');
  assert.equal((await noteState(first)).note.holding,true);assert.equal((await noteState(first)).note.judged,false);
  const empty=(await noteState(first)).empty;await c.key(code,'down',true);await c.key(code,'down');assert.equal((await noteState(first)).empty,empty);
  await c.key('Escape');await c.until(`document.getElementById('pause-dialog').open`);
  const paused=await record('native-head-repeat-and-pause',first);assert.deepEqual(paused.pending,[first.lane]);assert.equal(paused.audioState,'suspended');
  await shot('pause-hold-recovery');const frozen=await c.evaluate('audit.audio.time()');await c.key('Enter');assert.equal((await noteState(first)).dialog,true);assert.equal(await c.evaluate('audit.audio.time()'),frozen);
  report.cases.push({name:'resume-waits-for-real-key-recovery',frozen});
  await c.key(code,'up');await c.key(code,'down');assert.deepEqual((await noteState(first)).pending,[]);
  const {targetId}=await c.send('Target.createTarget',{url:'about:blank'});await c.send('Target.activateTarget',{targetId});await c.until('document.hidden');
  assert.deepEqual((await noteState(first)).pending,[first.lane]);
  await c.send('Target.closeTarget',{targetId});await c.send('Target.activateTarget',{targetId:targets.find(t=>t.type==='page').id});await c.until('!document.hidden');
  await record('real-tab-focus-loss-clears-recovered-key-without-free-completion',first);
  await c.key(code,'up');await c.evaluate(`document.querySelector('[data-hold-lane="${first.lane}"]').focus()`);await c.key('Space','down');await c.key('Enter');await c.until(`!document.getElementById('pause-dialog').open`);
  await shot('02-active-hold');await waitSong(c,first.endTime+.02);await c.key('Space','up');
  const success=await record('native-space-recovery-and-release-after-tail-success-once',first);assert.equal(success.judgments.length,1);assert.notEqual(success.judgments[0].type,'miss');assert.equal(success.note.holding,false);
  const second=holds[1];await waitSong(c,second.time);await c.key(keys[second.lane],'down');await waitSong(c,second.time+.2);await c.key(keys[second.lane],'up');
  assert.equal((await noteState(second)).judgments[0].type,'miss');const scoreBefore=(await noteState(second)).score;
  await c.key(keys[second.lane],'down');await c.key(keys[second.lane],'up');const failed=await record('native-early-release-and-repress-miss-once',second);assert.equal(failed.judgments.length,1);assert.ok(failed.empty>success.empty);assert.equal(failed.score,scoreBefore);
  if(!process.env.QA_HOLD_SHORT){
    const third=holds[2];await waitSong(c,third.time-.18);await c.key(keys[third.lane],'down');await waitSong(c,third.time+.17);await c.key(keys[third.lane],'down',true);await c.key(keys[third.lane],'up');
    const early=await record('native-too-early-fixed-key-and-os-repeat-cannot-start-hold',third);assert.equal(early.judgments.length,1);assert.equal(early.judgments[0].type,'miss');
    const fourth=holds[3];await waitSong(c,fourth.time);await c.key(keys[fourth.lane],'down');await waitSong(c,fourth.endTime-.06);await c.key(keys[fourth.lane],'up');
    assert.notEqual((await record('native-release-inside-80ms-tail-grace',fourth)).judgments[0].type,'miss');
    const fifth=holds[4];await waitSong(c,fifth.time);await c.key(keys[fifth.lane],'down');await waitSong(c,fifth.endTime);await c.key(keys[fifth.lane],'up');assert.equal((await record('native-exact-tail-release',fifth)).judgments.length,1);
    const sixth=holds[5];await waitSong(c,sixth.time+.17);await c.key(keys[sixth.lane],'down');await c.key(keys[sixth.lane],'up');assert.equal((await record('native-missed-head-cannot-be-rescued',sixth)).judgments[0].type,'miss');
    const seventh=holds[6];await waitSong(c,seventh.time);await mouse(`[data-lane="${seventh.lane}"]`,true);await c.key('Escape');await c.until(`document.getElementById('pause-dialog').open`);await mouse(null,false);
    await mouse(`[data-hold-lane="${seventh.lane}"]`,true);await c.key('Enter');await c.until(`!document.getElementById('pause-dialog').open`);await waitSong(c,seventh.endTime+.02);await mouse(null,false);
    const pointer=await record('native-pointer-recovery-survives-dialog-capture-loss-and-outside-up',seventh);assert.equal(pointer.judgments.length,1);assert.notEqual(pointer.judgments[0].type,'miss');assert.ok(!pointer.pressed.includes(seventh.lane));
    const eighth=holds[7];await waitSong(c,eighth.time);await c.key(keys[eighth.lane],'down');await waitSong(c,eighth.endTime+.12);await c.key(keys[eighth.lane],'up');const late=await record('native-late-release-no-duplicate-and-other-lane-taps',eighth);assert.equal(late.judgments.length,1);assert.notEqual(late.judgments[0].type,'miss');
    await c.until(`document.body.dataset.screen==='result'`,20000);
    report.nativeWholeSong=await c.evaluate(`({score:audit.session.score,counts:audit.session.counts,processed:audit.session.processed,empty:audit.session.emptyPresses,combo:audit.session.maxCombo,clear:document.getElementById('clear-status').textContent,inputs:audit.inputs,events:audit.events,judgments:audit.judgments})`);
    assert.equal(report.nativeWholeSong.processed,243);assert.equal(report.nativeWholeSong.counts.miss,3);assert.match(report.nativeWholeSong.clear,/TRACK FINISHED/);await shot('03-native-hold-results');
    await c.click('#retry-button');
  }else{await c.key('Escape');await c.until(`document.getElementById('pause-dialog').open`);await c.click('#quit-button');await c.click('#start-button')}
  await c.until(`document.body.dataset.screen==='game'&&audit.session?.processed===0`);assert.equal(await c.evaluate('audit.session.activeHolds.size'),0);assert.equal(await c.evaluate('audit.session.emptyPresses'),0);report.cases.push({name:'retry-clears-all-hold-state'});
  if(!process.env.QA_HOLD_SHORT){
    await schedule(chart);
    await waitSong(c,holds[0].time+.05);await shot('04-perfect-active-hold-desktop');
    await c.send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false});
    await c.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await waitSong(c,holds[1].time+.15);await shot('05-perfect-hold-375-reduced');
    assert.ok(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'));assert.ok(await c.evaluate('[...document.querySelectorAll("[data-lane]")].every(b=>b.getBoundingClientRect().width>=44)'));
    await c.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:false});await waitSong(c,holds[2].time+.15);await shot('06-perfect-hold-landscape');
    assert.ok(await c.evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await c.send('Emulation.setDeviceMetricsOverride',{width:1000,height:760,deviceScaleFactor:1,mobile:false});await c.send('Emulation.setEmulatedMedia',{features:[]});
    await c.until(`document.body.dataset.screen==='result'`,80000);
    report.perfectWholeSong=await c.evaluate(`({score:audit.session.score,counts:audit.session.counts,processed:audit.session.processed,accuracy:audit.session.accuracy,combo:audit.session.maxCombo,empty:audit.session.emptyPresses,fullCombo:audit.session.fullCombo,clear:document.getElementById('clear-status').textContent,inputs:audit.inputs,judgments:audit.judgments,plan:audit.planned,records:JSON.parse(localStorage.getItem('pulse-shift-records'))})`);
    assert.equal(report.perfectWholeSong.score,1000000);assert.equal(report.perfectWholeSong.accuracy,100);assert.equal(report.perfectWholeSong.combo,243);assert.equal(report.perfectWholeSong.processed,243);assert.equal(report.perfectWholeSong.empty,0);assert.equal(report.perfectWholeSong.clear,'FULL COMBO');assert.equal(report.perfectWholeSong.counts.miss,0);assert.ok(report.perfectWholeSong.records['astral-veil:6k:normal:hold-v1']);await shot('07-perfect-hold-results');report.cases.push({name:'hold-aware-real-time-full-combo-and-million-point-oracle'});
  }else{await c.key('Escape');await c.until(`document.getElementById('pause-dialog').open`);await c.click('#quit-button')}
  report.errors=c.evidence;assert.equal(c.evidence.filter(e=>e.method==='Runtime.exceptionThrown'||e.params?.entry?.level==='error').length,0);report.status='passed';
} catch(error){report.status='failed';report.error=String(error);console.error(String(error));process.exitCode=1}
finally{report.completedAt=new Date().toISOString();report.output=output;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await writeFile(join(root,'artifacts/hold-qa/latest.json'),JSON.stringify({output,status:report.status},null,2));console.log('OUTPUT',output);for(const socket of connections)socket.close();chrome?.kill();server?.kill();if(profile){await pause(250);await rm(profile,{recursive:true,force:true})}}
