import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'artifacts/input-qa',new Date().toISOString().replace(/[:.]/g,'-'));
await mkdir(output,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const report={startedAt:new Date().toISOString(),limitations:['Muted headless Chrome with a fresh temporary profile. No user tabs or records touched. CDP input is trusted browser input, not a physical keyboard. Full-song fixed all-lane input is page-scheduled with fresh KeyboardEvents; does not inspect chart or forge timestamps. Device acoustics, Bluetooth and display latency are unmeasured.'],cases:[]};
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
  const key=async(code,type='tap',repeat=false)=>{const k=code.startsWith('Key')?code.slice(3).toLowerCase():code,vk=code.startsWith('Key')?code.charCodeAt(3):code==='Escape'?27:13;const p={key:k,code,windowsVirtualKeyCode:vk};if(type!=='up')await send('Input.dispatchKeyEvent',{type:'keyDown',autoRepeat:repeat,...p});if(type!=='down')await send('Input.dispatchKeyEvent',{type:'keyUp',...p})};
  return {send,evaluate,until,click,key,evidence};
}
async function setup(c,url) {
  await Promise.all([c.send('Page.enable'),c.send('Runtime.enable'),c.send('Log.enable')]);
  await c.send('Emulation.setDeviceMetricsOverride',{width:1000,height:760,deviceScaleFactor:1,mobile:false});
  await c.send('Page.addScriptToEvaluateOnNewDocument',{source:hook});
  await c.send('Page.navigate',{url});await c.until(`document.body.dataset.screen==='menu'`);
  await c.evaluate(`Promise.all([import('./src/game.js'),import('./src/audio.js')]).then(([{Session},{AudioEngine}])=>{
    const hit=Session.prototype.hit,resolve=Session.prototype.resolve,expire=Session.prototype.expire,time=AudioEngine.prototype.time,play=AudioEngine.prototype.play;
    Session.prototype.expire=function(t){audit.session=this;return expire.call(this,t)};
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
  const port=Number(process.env.QA_PORT||4195),url=process.env.QA_URL||`http://127.0.0.1:${port}/`;
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
  report.browser=await control.send('Browser.getVersion');await setup(control,url);await configure(control,'afterglow',4,'easy');
  await control.key('KeyD');report.cases.push({name:'countdown-key',snapshot:await snapshot(control)});
  assert.equal((await snapshot(control)).inputs,0);
  const first=8*60/148;
  await waitSong(control,first);await control.key('KeyD','down');
  const afterFirst=await snapshot(control);assert.equal(afterFirst.counts.perfect,1);
  await control.key('KeyD','down',true);assert.equal((await snapshot(control)).score,afterFirst.score);
  await control.key('KeyD','down');assert.equal((await snapshot(control)).score,afterFirst.score);
  assert.equal((await snapshot(control)).combo,1);assert.equal((await snapshot(control)).emptyPresses,0);
  await control.key('KeyF');await control.key('KeyJ');
  report.cases.push({name:'valid-first-hit-repeat-held-duplicate-empty-and-early',snapshot:await snapshot(control)});
  await waitSong(control,first+.18);await control.key('KeyD','up');await control.key('KeyD');
  report.cases.push({name:'keyup-new-too-early-key',snapshot:await snapshot(control)});
  await waitSong(control,first+2*60/148+.20);
  const missed=await snapshot(control);assert.equal(missed.combo,0);assert.equal(missed.counts.miss,1);
  report.cases.push({name:'omitted-next-note-resets-current-combo-preserves-max',snapshot:missed});
  {
    await waitSong(control,first+4*60/148);await control.click('[data-lane="2"]');
    report.cases.push({name:'native-mouse-pointer-lane-hit',snapshot:await snapshot(control)});
    const threshold=first+6*60/148+.140;
    const boundary=await control.evaluate(`new Promise(resolve=>{const threshold=${threshold};function tick(){const t=audit.audio.time();if(t<threshold-.012){setTimeout(tick,1);return}const before={combo:audit.session.combo,label:document.getElementById('combo-label').textContent,miss:audit.session.counts.miss};while(audit.audio.time()<threshold+.001){}window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyF',key:'f',bubbles:true,cancelable:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyF',key:'f',bubbles:true,cancelable:true}));const after={combo:audit.session.combo,label:document.getElementById('combo-label').textContent,miss:audit.session.counts.miss,judgment:document.getElementById('judgment-label').textContent};requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({before,after,afterTwoFrames:{combo:audit.session.combo,label:document.getElementById('combo-label').textContent,miss:audit.session.counts.miss,judgment:document.getElementById('judgment-label').textContent}})))}tick()})`);
    assert.equal(boundary.after.combo,0);assert.equal(boundary.after.label,'');assert.equal(boundary.afterTwoFrames.label,'');assert.equal(boundary.afterTwoFrames.judgment,'EMPTY');
    report.cases.push({name:'empty-input-expires-note-between-render-frames',...boundary});
    await waitSong(control,first+8*60/148);await control.key('KeyF','down');
    const holdScore=(await snapshot(control)).score;
    await waitSong(control,first+10*60/148);await control.evaluate(`document.querySelector('[data-lane="0"]').click()`);
    report.cases.push({name:'accessible-detail-zero-button-activation',snapshot:await snapshot(control)});
    const scoreBeforeRepeat=(await snapshot(control)).score;
    await waitSong(control,first+20*60/148);await control.key('KeyF','down',true);
    assert.equal((await snapshot(control)).score,scoreBeforeRepeat);
    report.cases.push({name:'held-key-os-repeat-at-next-same-lane-note-does-not-score',snapshot:await snapshot(control),holdScore});
    await control.key('KeyF','up');await control.key('KeyF');
    assert.ok((await snapshot(control)).score>scoreBeforeRepeat);
    report.cases.push({name:'release-then-new-keydown-scores-next-same-lane-note',snapshot:await snapshot(control)});
  }
  await control.key('Escape');await control.until(`document.getElementById('pause-dialog').open`);
  const beforePauseInput=await snapshot(control);await control.key('KeyD');
  assert.deepEqual((await snapshot(control)).counts,beforePauseInput.counts);assert.equal((await snapshot(control)).emptyPresses,beforePauseInput.emptyPresses);
  report.cases.push({name:'paused-lane-input-does-not-judge',snapshot:await snapshot(control)});
  await control.key('Enter');await control.until(`!document.getElementById('pause-dialog').open`);
  assert.ok(await control.evaluate(`![...document.querySelectorAll('[data-lane]')].some(e=>e.classList.contains('pressed'))`));
  await control.key('Escape');await control.until(`document.getElementById('pause-dialog').open`);await control.click('#quit-button');
  const beforeMenuInput=await snapshot(control);await control.key('KeyD');assert.equal((await snapshot(control)).emptyPresses,beforeMenuInput.emptyPresses);
  report.cases.push({name:'menu-lane-input-does-not-judge',snapshot:await snapshot(control)});
  report.nativeAudit=await control.evaluate(`({events:audit.events,inputs:audit.inputs,judgments:audit.judgments,longTasks:audit.longTasks})`);
  report.nativeErrors=control.evidence;
  assert.equal(control.evidence.filter(e=>e.method==='Runtime.exceptionThrown'||e.params?.entry?.level==='error').length,0);
  console.log('NATIVE_RULE_CASES',JSON.stringify(report.cases));
  report.fallbackClocks=await control.evaluate(`import('./src/audio.js').then(({AudioEngine})=>[undefined,()=>({contextTime:0,performanceTime:0}),()=>({contextTime:5,performanceTime:performance.now()-1000})].map(getOutputTimestamp=>{let a=new AudioEngine();a.source={};a.startTime=3;a.context={currentTime:10.05,outputLatency:.03,baseLatency:.005,getOutputTimestamp};let now=performance.now(),event=a.time(now-80),handler=a.time(now);return{event,handler,ageMs:(handler-event)*1000}}))`);
  for(const clock of report.fallbackClocks)assert.ok(Math.abs(clock.ageMs-80)<1);
  console.log('FALLBACK_CLOCKS',JSON.stringify(report.fallbackClocks));
  await configure(control,'afterglow',4,'easy');await control.until(`audit.session?.processed===0`);
  assert.equal((await snapshot(control)).emptyPresses,0);assert.equal((await snapshot(control)).combo,0);
  report.cases.push({name:'new-session-clears-empty-presses',snapshot:await snapshot(control)});
  await control.key('Escape');await control.until(`document.getElementById('pause-dialog').open`);await control.click('#quit-button');
  const specs=process.env.QA_INPUT_SHORT?[]:[['astral-veil',4,'normal'],['astral-veil',4,'hard'],['astral-veil',6,'normal'],['astral-veil',6,'hard'],['afterglow',4,'normal'],['tidal-circuit',4,'normal']];
  report.wholeSongs=[];
  // Run each visible tab to completion before opening another: normal hidden-tab
  // auto-pause is part of the game and must not be bypassed by the diagnostic.
  for(const [track,keys,difficulty] of specs){
    const {targetId}=await control.send('Target.createTarget',{url:'about:blank'});
    const target=(await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t=>t.id===targetId);
    const c=attach(target.webSocketDebuggerUrl);await setup(c,url);await configure(c,track,keys,difficulty);
    await c.evaluate(`(()=>{let codes=${JSON.stringify(keys===6?['KeyS','KeyD','KeyF','KeyJ','KeyK','KeyL']:['KeyD','KeyF','KeyJ','KeyK'])},next=0;audit.pulses=[];function tick(){if(document.body.dataset.screen!=='game')return;let t=audit.audio.time(performance.now());if(t>=next&&audit.audio.context.state==='running'){audit.pulses.push({planned:next,actual:t});for(let code of codes){window.dispatchEvent(new KeyboardEvent('keydown',{code,key:code.slice(3).toLowerCase(),bubbles:true,cancelable:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code,key:code.slice(3).toLowerCase(),bubbles:true,cancelable:true}))}next+=.2;}setTimeout(tick,4)}tick()})()`);
    console.log('FIXED_SPAM_STARTED',track,keys,difficulty);
    await c.until(`document.body.dataset.screen==='result'`,100000);
    const data=await c.evaluate(`({counts:audit.session.counts,score:audit.session.score,combo:audit.session.combo,maxCombo:audit.session.maxCombo,noteCount:audit.session.notes.length,inputs:audit.inputs,judgments:audit.judgments,frames:audit.frames,events:audit.events,pulses:audit.pulses,longTasks:audit.longTasks,clear:document.getElementById('clear-status').textContent,offset:Number(JSON.parse(localStorage.getItem('pulse-shift-settings')).offset),sampleRate:audit.audio.context.sampleRate,emptyPresses:audit.session.emptyPresses,fullCombo:audit.session.fullCombo})`);
    report.wholeSongs.push({track,keys,difficulty,...data,errors:c.evidence});
    assert.equal(c.evidence.filter(e=>e.method==='Runtime.exceptionThrown'||e.params?.entry?.level==='error').length,0);
    const shot=await c.send('Page.captureScreenshot',{format:'png'});await writeFile(join(output,`${track}-${keys}-${difficulty}.png`),Buffer.from(shot.data,'base64'));
    console.log('SPAM_RESULT',JSON.stringify({track,keys,difficulty,notes:data.noteCount,counts:data.counts,score:data.score,maxCombo:data.maxCombo,emptyPresses:data.emptyPresses,clear:data.clear}));
    assert.equal(data.counts.miss,0);assert.ok(data.emptyPresses>0);assert.ok(data.maxCombo<data.noteCount);assert.equal(data.fullCombo,false);assert.match(data.clear,/TRACK FINISHED.*EMPTY/);
    await c.key('KeyD');assert.equal((await snapshot(c)).emptyPresses,data.emptyPresses);
  }
  report.status='passed';
} catch(error){report.status='failed';report.error=String(error);console.error(String(error));process.exitCode=1}
finally{report.completedAt=new Date().toISOString();report.output=output;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await writeFile(join(root,'artifacts/input-qa/latest.json'),JSON.stringify({output,status:report.status},null,2));console.log('OUTPUT',output);for(const socket of connections)socket.close();chrome?.kill();server?.kill();if(profile){await pause(250);await rm(profile,{recursive:true,force:true})}}
