import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pageScheduledInputs = process.env.QA_INPUT_DRIVER === 'page';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = join(root, 'artifacts', 'demo-qa', stamp);
await mkdir(output, { recursive: true });
const report = { version: 'v1 / DJMAX-inspired / PULSE SHIFT 0.6.0', baseline: 'pulse-shift-demo standalone snapshot', startedAt: new Date().toISOString(), status: 'running', checks: [], limitations: ['Headless Chrome output is muted. Real speaker/headphone sound, subjective fun and physical input latency require a human rehearsal.', 'Keyboard input is automated, not a human performance. QA_INPUT_DRIVER=page schedules full-song events inside the page; startup, native first-hit/duplicate, hold/release and menu controls still use CDP.', 'The catalog contains only the two bundled originals; file import and automatic chart analysis are removed.'] };
const log = (message) => console.log(message);
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let chrome, server, socket, profile, serverLog = '', chromeLog = '', cdp;
const evidence = [];

async function command(args, filename) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  await writeFile(join(output, filename), stdout + stderr);
  assert.equal(code, 0, `${filename} failed; see ${output}`);
  log(`PASS ${filename}`);
}

async function fingerprints() {
  const paths = ['.gitignore', 'index.html', 'styles.css', 'track-selector.css', 'menu-background.css', 'playfield.css', 'package.json', 'README.md', 'AGENTS.md', 'DEMO.md', 'CHANGELOG.md', 'server.mjs'];
  for (const folder of ['src', 'scripts', 'tests', 'assets']) {
    const walk = async dir => { for (const entry of await readdir(join(root, dir), { withFileTypes: true })) { const p = `${dir}/${entry.name}`; if (entry.isDirectory()) await walk(p); else paths.push(p); } };
    await walk(folder);
  }
  const hashes = {};
  for (const path of paths.sort()) hashes[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  await writeFile(join(output, 'fingerprints.json'), JSON.stringify({ algorithm: 'SHA-256', baseline: report.baseline, files: hashes }, null, 2));
  report.fingerprintFile = 'fingerprints.json';
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await wait(40); }
  throw Error(`Timeout waiting for ${expression}`);
}
async function click(selector) {
  await until(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});return !!e&&!e.disabled&&!e.closest('[hidden]')})()`);
  const point = await evaluate(`(()=>{let e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});let r=e.getBoundingClientRect();let x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,intercepted:!e.contains(document.elementFromPoint(x,y)),top:document.elementFromPoint(x,y)?.outerHTML.slice(0,200)}})()`);
  assert.equal(point.intercepted, false, `${selector} is covered by ${point.top}`);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: point.x, y: point.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x, y: point.y });
}
const keyInfo = { KeyS: ['s', 83], KeyL: ['l', 76], KeyD: ['d', 68], KeyF: ['f', 70], KeyJ: ['j', 74], KeyK: ['k', 75], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], Enter: ['Enter', 13], Escape: ['Escape', 27] };
async function key(code, repeat = false) {
  const [value, vk] = keyInfo[code];
  const params = { key: value, code, windowsVirtualKeyCode: vk };
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', autoRepeat: repeat, ...params });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
}
async function snapshot() {
  return evaluate(`({screen:document.body.dataset.screen,title:document.getElementById('track-title').textContent,elapsed:document.getElementById('play-elapsed').textContent,paused:document.getElementById('pause-dialog').open,score:Number(document.getElementById('live-score').textContent),counts:Object.fromEntries(['perfect','great','good','miss'].map(k=>[k,Number(document.getElementById('count-'+k).textContent)])),combo:Number(document.getElementById('live-max-combo').textContent),preview:document.getElementById('preview-button').getAttribute('aria-pressed'),lobby:document.getElementById('lobby-music').dataset.state,audio:window.__demoAudit.contexts.map(c=>({state:c.state,time:c.currentTime,outputLatency:c.outputLatency})),menuError:document.getElementById('menu-error').hidden?null:document.getElementById('menu-error').textContent,toast:document.getElementById('toast').hidden?null:document.getElementById('toast').textContent})`);
}
async function check(name, details = {}) {
  report.checks.push({ name, ...details, snapshot: await snapshot() });
  log(`PASS ${name}`);
}
async function screenshot(name) {
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(output, `${name}.png`), Buffer.from(result.data, 'base64'));
}
const auditHook = `window.__demoAudit={contexts:[],sources:[],events:[]};for(const type of ['blur','focus','keydown','click','visibilitychange'])window.addEventListener(type,e=>window.__demoAudit.events.push({type,code:e.code,repeat:e.repeat,hidden:document.hidden,target:e.target?.id,at:performance.now()}));const NativeAudioContext=window.AudioContext;window.AudioContext=class extends NativeAudioContext{constructor(o){super(o);window.__demoAudit.contexts.push(this)}createBufferSource(){const s=super.createBufferSource(),start=s.start.bind(s),stop=s.stop.bind(s);s.start=(...a)=>{s.auditStart=a;return start(...a)};s.stop=(...a)=>{s.auditStop=a;return stop(...a)};window.__demoAudit.sources.push(s);return s}};`;
async function comboCount() { return evaluate('window.__demoAudit.sources.filter(s=>s.auditStart&&[0.3,0.48].some(d=>Math.abs((s.buffer?.duration||0)-d)<0.0001)).length'); }
async function songClock() {
  // Mirror AudioEngine.outputTime: a resumed context may return a stale or zero
  // device timestamp. Recheck the clock while waiting instead of scheduling an
  // entire note from that one transient timestamp.
  return evaluate(`(()=>{let c=window.__demoAudit.contexts[0],s=window.__demoAudit.sources.findLast(s=>s.buffer?.duration>60&&s.auditStart&&!s.auditStop),t=c.getOutputTimestamp(),now=performance.now();let output=t.contextTime>0&&t.performanceTime>0&&now-t.performanceTime<250?t.contextTime+(now-t.performanceTime)/1000:c.currentTime-(c.outputLatency||c.baseLatency||0);return output-s.auditStart[0]+(s.auditStart[1]||0)})()`);
}
async function waitForNote(time) {
  let remaining;
  while ((remaining = (time - await songClock()) * 1000) > 0) await wait(Math.min(40, remaining));
}
// Optional page timer avoids inter-process delivery jitter on busy machines.
// Fresh keyboard events enter the normal handlers; no score or event time is forged.
async function schedulePageInputs(plan) {
  await evaluate(`(() => {
    const plan = ${JSON.stringify(plan)}; let index = 0;
    window.__demoAudit.scheduledInputs = 0;
    function tick() {
      const c = window.__demoAudit.contexts[0];
      const source = window.__demoAudit.sources.findLast(s => s.buffer?.duration > 60 && s.auditStart && !s.auditStop);
      if (!source || document.body.dataset.screen !== 'game') return;
      if (c.state === 'running' && !document.getElementById('pause-dialog').open) {
        const stamp = c.getOutputTimestamp(), now = performance.now();
        const output = stamp.contextTime > 0 && stamp.performanceTime > 0 && now - stamp.performanceTime < 250 ? stamp.contextTime + (now - stamp.performanceTime) / 1000 : c.currentTime - (c.outputLatency || c.baseLatency || 0);
        const time = output - source.auditStart[0] + (source.auditStart[1] || 0);
        while (index < plan.length && time >= plan[index].time) {
          for (const code of plan[index++].codes) {
            const key = code.slice(3).toLowerCase();
            window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
            window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
            window.__demoAudit.scheduledInputs++;
          }
        }
      }
      if (index < plan.length) setTimeout(tick, 4);
    }
    tick();
  })()`);
}
async function navigate() {
  await cdp('Page.navigate', { url: report.url });
  await until('document.body.dataset.screen === "menu"');
  // Observe exact engine inputs/results without changing their return values.
  await evaluate(`window.__demoAudit.longTasks=[];new PerformanceObserver(list=>window.__demoAudit.longTasks.push(...list.getEntries().map(e=>({at:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});import('/src/game.js').then(({Session})=>{
    const audit=window.__demoAudit;audit.inputs=[];audit.judgments=[];
    const hit=Session.prototype.hit,resolve=Session.prototype.resolve;
    Session.prototype.hit=function(lane,time){const result=hit.call(this,lane,time);audit.inputs.push({lane,time,result,at:performance.now()});return result};
    Session.prototype.resolve=function(note,type,delta){const result=resolve.call(this,note,type,delta);if(result)audit.judgments.push({...result,noteId:note.id,at:performance.now()});return result};
  })`);
}

try {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.6.0', 'This harness belongs to the preferred v1, not v2.');
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('LP 턴테이블 곡 선택') && !html.includes('CAN CLUB'), 'Wrong version entry point');
  await fingerprints();
  const tests = (await readdir(join(root, 'tests'))).filter(file => file.endsWith('.test.mjs')).sort().map(file => `tests/${file}`);
  await command(['--test', ...tests], 'unit-tests.txt');
  const modules = [...(await readdir(join(root, 'src'))).filter(file => file.endsWith('.js')).map(file => `src/${file}`), 'server.mjs', 'scripts/render-lobby.mjs', 'scripts/verify-demo.mjs'];
  for (const module of modules) await command(['--check', module], `syntax-${module.replaceAll('/', '-')}.txt`);

  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  let executable;
  for (const candidate of candidates) { try { await access(candidate); executable = candidate; break; } catch {} }
  if (!executable) throw Error('Browser verification blocked: installed Chrome/Chromium not found. Set CHROME_PATH. Nothing is installed automatically.');
  const port = Number(process.env.QA_PORT || 4186);
  report.url = `http://127.0.0.1:${port}/`;
  server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { serverLog += chunk; }); server.stderr.on('data', chunk => { serverLog += chunk; });
  for (let i = 0; i < 100 && !serverLog.includes('PULSE SHIFT →'); i++) { if (server.exitCode !== null) throw Error(serverLog); await wait(40); }
  assert.ok(serverLog.includes('PULSE SHIFT →'), 'QA server did not start; choose a free QA_PORT');
  profile = await mkdtemp(join(tmpdir(), 'pulse-shift-v1-qa-'));
  chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-sync', '--disable-extensions', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', chunk => { chromeLog += chunk; });
  let debugPort;
  for (let i = 0; i < 100; i++) { try { debugPort = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { if (chrome.exitCode !== null) throw Error(chromeLog); await wait(50); } }
  assert.ok(debugPort, 'Isolated browser did not start');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const target = targets.find(item => item.type === 'page');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0, expectedFault = null;
  const pending = new Map();
  report.slowCommands = [];
  cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject, method, started: performance.now() }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) { const task = pending.get(message.id); if (!task) return; pending.delete(message.id); const elapsed=performance.now()-task.started;if(elapsed>60)report.slowCommands.push({method:task.method,durationMs:elapsed,at:performance.now()}); message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result); }
    else {
      evidence.push({ ...message, expectedFault });
      if (message.method === 'Fetch.requestPaused') cdp('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: Buffer.from('Intentional QA load failure').toString('base64') }).catch(error => { report.interceptionError = String(error); });
    }
  });
  await Promise.all([cdp('Page.enable'), cdp('Runtime.enable'), cdp('Log.enable'), cdp('Network.enable')]);
  report.browser = await cdp('Browser.getVersion'); report.browser.executable = executable; report.browser.isolatedProfile = true; report.browser.mutedOutput = true;
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: auditHook });
  await navigate();
  assert.equal((await snapshot()).audio.length, 0, 'No audio should autoplay before a trusted gesture');
  await screenshot('01-v1-track-select'); await check('v1 entry point; audio waits for gesture');
  const catalog=await evaluate(`({tracks:[...document.querySelectorAll('[data-disc-card]')].map(b=>b.dataset.builtinTrack),count:document.getElementById('tracklist-count').textContent,fileInputs:document.querySelectorAll('input[type="file"]').length,importControls:document.querySelectorAll('#music-import,#empty-disc,#custom-track').length})`);
  assert.deepEqual(catalog,{tracks:['afterglow','tidal-circuit','astral-veil'],count:'03',fileInputs:0,importControls:0});
  await cdp('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false});
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await evaluate('document.documentElement.scrollWidth'),375);
  assert.equal(await evaluate(`document.querySelectorAll('[data-disc-card][data-position="0"]').length`),1);
  await screenshot('00-three-track-mobile');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await check('three-song catalog without upload controls; mobile menu has no overflow',{catalog});
  await key('ArrowRight'); await until('document.getElementById("track-title").textContent === "TIDAL CIRCUIT" && document.getElementById("lobby-music").dataset.state === "playing"');
  await check('trusted key unlocks audio and selects TIDAL CIRCUIT');
  const loadingStarted = Date.now(); await click('#preview-button'); await until('document.getElementById("preview-button").getAttribute("aria-pressed") === "true"');
  const pcm = await evaluate(`(()=>{const b=window.__demoAudit.sources.findLast(s=>s.buffer?.duration>60&&!s.auditStop).buffer,a=b.getChannelData(0);let squares=0,peak=0;for(let i=0;i<a.length;i+=16){squares+=a[i]*a[i];peak=Math.max(peak,Math.abs(a[i]))}return{duration:b.duration,channels:b.numberOfChannels,sampleRate:b.sampleRate,rms:Math.sqrt(squares/(a.length/16)),peak}})()`);
  assert.ok(pcm.rms > 0.001 && pcm.peak <= 1 && pcm.channels === 2);
  await check('original preview has running stereo PCM', { loadingMs: Date.now() - loadingStarted, pcm });
  await key('ArrowLeft'); await until('document.getElementById("track-title").textContent === "AFTERGLOW"'); assert.equal((await snapshot()).preview, 'false');
  await key('ArrowRight'); await click('[data-difficulty="normal"]'); await click('#start-button'); await until('document.body.dataset.screen === "game"');
  const countsZero = { perfect: 0, great: 0, good: 0, miss: 0 };
  assert.deepEqual((await snapshot()).counts, countsZero); await check('start countdown and clean session');
  await key('KeyD'); assert.equal((await snapshot()).score, 0, 'Countdown inputs must not score');
  await key('Escape'); await until('document.getElementById("pause-dialog").open'); const frozenBefore = await evaluate('window.__demoAudit.contexts[0].currentTime'); await wait(400); const frozenAfter = await evaluate('window.__demoAudit.contexts[0].currentTime'); assert.equal(frozenAfter, frozenBefore);
  await key('Enter'); await until('!document.getElementById("pause-dialog").open'); await check('Esc/Enter pause/resume freezes audio clock', { frozenBefore, frozenAfter });


  const chart = await evaluate(`import('/src/tracks.js').then(m=>m.BUILTIN_TRACKS[1].charts.normal)`);
  const groups = [];
  for (const note of chart) { const last = groups.at(-1); if (last?.time === note.time) last.notes.push(note); else groups.push({ time: note.time, notes: [note] }); }
  if (pageScheduledInputs) {
    let count = 0;
    const plan = groups.map(group => {
      const offset = count >= 10 && count < 20 ? (count % 2 ? .1 : .065) : 0;
      count += group.notes.length;
      return { time: group.time + offset, codes: group.notes.map(n => ['KeyD','KeyF','KeyJ','KeyK'][n.lane]) };
    });
    await schedulePageInputs(plan.slice(1)); // First hit remains native.
  }
  report.inputDriver = pageScheduledInputs ? 'page-scheduled full songs; native first hit and UI contracts' : 'native CDP';
  let inputs = 0, capturedPlay = false, playScreenshot = false;
  for (const [groupIndex, group] of groups.entries()) {
    const current = await snapshot();
    assert.equal(current.paused, false, 'Browser lost focus during scheduled playback');
    assert.equal(current.counts.miss, 0, 'Scheduled input missed a note; capture diagnostic timing immediately');
    const intentionalOffset = inputs >= 10 && inputs < 20 ? (inputs % 2 ? .1 : .065) : 0;
    if (pageScheduledInputs && groupIndex > 0) {
      await until(`window.__demoAudit.scheduledInputs >= ${inputs + group.notes.length - groups[0].notes.length}`);
      inputs += group.notes.length;
    } else {
    await waitForNote(group.time + intentionalOffset);
    for (const note of group.notes) { await key(['KeyD', 'KeyF', 'KeyJ', 'KeyK'][note.lane]); inputs++; if (inputs === 1) { const before = (await snapshot()).score; await key(['KeyD', 'KeyF', 'KeyJ', 'KeyK'][note.lane]); await key(['KeyD', 'KeyF', 'KeyJ', 'KeyK'][note.lane], true); assert.equal((await snapshot()).score, before, 'Duplicate/repeat input must not add points'); } }
    }
    if (!capturedPlay && inputs >= 10) { assert.equal(await comboCount(), 1, 'First 10 combo must play one combo cue'); await check('native inputs, judgments, combo and duplicate protection'); capturedPlay = true; }
    // PNG capture blocks the control process. Use a gap in the authored chart
    // instead of delaying the next native input in a dense run of notes.
    if (!playScreenshot && inputs >= 10 && groups[groupIndex + 1]?.time - await songClock() > 0.6) {
      const before = await songClock(), started = performance.now();
      await screenshot('02-v1-playing');
      report.playCapture = { before, after: await songClock(), durationMs: performance.now() - started, nextNote: groups[groupIndex + 1].time };
      playScreenshot = true;
    }
  }
  assert.ok(playScreenshot, 'The authored chart must provide a safe screenshot gap');
  await until('document.body.dataset.screen === "result"', 12000);
  const final = await evaluate(`({score:Number(document.getElementById('result-score').textContent.replaceAll(',','')),accuracy:parseFloat(document.getElementById('result-accuracy').textContent),combo:Number(document.getElementById('result-combo').textContent),grade:document.getElementById('result-grade').textContent,counts:Object.fromEntries(['perfect','great','good','miss'].map(k=>[k,Number(document.getElementById('result-'+k).textContent)]))})`);
  assert.equal(Object.values(final.counts).reduce((a, b) => a + b, 0), chart.length, 'Every note must resolve exactly once');
  report.tidalInputAudit = await evaluate('({inputs:window.__demoAudit.inputs,judgments:window.__demoAudit.judgments})');
  assert.equal(final.counts.miss, 0, 'Scheduled input missed a note; investigate timing instead of weakening this check');
  assert.equal(final.combo, chart.length); assert.equal(inputs, chart.length);
  const weight = final.counts.perfect + final.counts.great * 0.7 + final.counts.good * 0.3;
  assert.equal(final.score, Math.round(weight / chart.length * 1000000)); assert.ok(Math.abs(final.accuracy - weight / chart.length * 100) <= 0.0051);
  const expectedGrade = final.accuracy >= 99 ? 'S' : final.accuracy >= 95 ? 'A' : final.accuracy >= 85 ? 'B' : final.accuracy >= 70 ? 'C' : 'D'; assert.equal(final.grade, expectedGrade);
  assert.ok(final.counts.great > 0 && final.counts.good > 0, 'GOOD/GREAT inputs must be exercised');
  assert.equal(await comboCount(), 4, 'Only 10/50/100/150 combo milestones may play a cue');
  await check('combo-only effects across GOOD/GREAT/PERFECT inputs', {callouts:4,milestones:[10,50,100,150]});
  await screenshot('03-v1-results'); await check('one real-time whole song, score oracle and results', { final, notes: chart.length, automatedInputs: inputs, inputDriver: report.inputDriver });
  await click('#retry-button'); await until('document.body.dataset.screen === "game"'); assert.deepEqual((await snapshot()).counts, countsZero); assert.equal((await snapshot()).score, 0); assert.equal((await snapshot()).elapsed, '00:00'); await check('retry resets all gameplay counters');
  const other = await cdp('Target.createTarget', { url: 'about:blank' }); await cdp('Target.activateTarget', { targetId: other.targetId }); await until('document.visibilityState === "hidden" && document.getElementById("pause-dialog").open');
  await cdp('Target.activateTarget', { targetId: target.id }); await until('document.visibilityState === "visible"'); assert.equal((await snapshot()).paused, true); await cdp('Page.bringToFront'); await wait(150); await key('Enter'); await until('!document.getElementById("pause-dialog").open'); await wait(150); assert.equal((await snapshot()).paused, false);
  await check('ordinary browser tab switch auto-pauses and returns safely');
  const resumedBefore = await evaluate('window.__demoAudit.contexts[0].currentTime'); await wait(500); assert.equal((await snapshot()).paused, false); assert.ok(await evaluate('window.__demoAudit.contexts[0].currentTime') > resumedBefore);

  await key('Escape'); await until('document.getElementById("pause-dialog").open'); await click('#quit-button'); await until('document.body.dataset.screen === "menu" && document.getElementById("lobby-music").dataset.state === "playing"');
  assert.equal(Number((await evaluate('document.getElementById("best-score").textContent')).replaceAll(',', '')), final.score); await check('menu restores lobby and per-track best record');
  for (const [selector,title] of [['#track-next','ASTRAL VEIL'],['#track-next','AFTERGLOW'],['#track-previous','ASTRAL VEIL'],['#track-previous','TIDAL CIRCUIT'],['#builtin-track','AFTERGLOW'],['#astral-track','ASTRAL VEIL'],['#tidal-track','TIDAL CIRCUIT']]) {
    // Native pointer coordinates must be taken after the cover reaches its slot.
    await evaluate(`Promise.all(document.querySelector('.disc-rack').getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))`);
    await click(selector);await until(`document.getElementById('track-title').textContent === ${JSON.stringify(title)}`);
    assert.equal(await evaluate(`document.querySelectorAll('[data-disc-card][aria-pressed="true"]').length`),1);
  }
  await check('three-track wraparound buttons and album cover selection');

  // A known legacy four-key fixture verifies backward-compatible record separation.
  await evaluate(`(()=>{const r=JSON.parse(localStorage.getItem('pulse-shift-records')||'{}');r['afterglow:easy']={score:500000,accuracy:50,grade:'D',maxCombo:20};localStorage.setItem('pulse-shift-records',JSON.stringify(r))})()`);
  await navigate(); await click('[data-difficulty="easy"]');
  assert.equal(await evaluate('document.getElementById("best-score").textContent'), '500,000');
  await click('button[data-key-count="6"]');
  assert.equal(await evaluate('document.body.dataset.keyCount'), '6');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('button[data-key-count]')].map(b=>({key:b.dataset.keyCount,pressed:b.getAttribute('aria-pressed'),disabled:b.disabled}))`), [{key:'4',pressed:'false',disabled:false},{key:'6',pressed:'true',disabled:false}]);
  assert.equal(await evaluate('document.getElementById("best-score").textContent'), '—', 'Six-key must not inherit a four-key record');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-lane]')].map(b=>b.textContent)`), ['S','D','F','J','K','L']);
  assert.ok(await evaluate(`document.querySelector('[data-difficulty="normal"]').disabled&&document.querySelector('[data-difficulty="hard"]').disabled`));
  assert.equal(await evaluate('document.getElementById("header-key-count").textContent'), '6 KEY RHYTHM · EXPERIMENT');
  assert.equal(await evaluate('document.getElementById("settings-key-count").textContent'), '6 KEY LAYOUT');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.settings-keys kbd')].map(k=>k.textContent)`), ['S','D','F','J','K','L']);
  await screenshot('06-v1-six-key-select');
  await click('#settings-button'); assert.ok(await evaluate('document.getElementById("settings-dialog").open'));
  assert.equal(await evaluate('document.querySelectorAll("[data-combo-preview]").length'), 2);
  const beforePreview = await comboCount();
  for (const id of ['combo-preview-button', 'combo-major-preview-button']) {
    await click('#' + id); await until(`!document.getElementById('${id}').disabled`);
  }
  assert.equal(await comboCount(), beforePreview + 2, 'Both short combo variants preview');
  await screenshot('09-v1-combo-effect-settings');
  await evaluate(`document.querySelector('.settings-keys').scrollIntoView({block:'center'})`);
  await screenshot('07-v1-six-key-settings'); await click('#settings-dialog [data-close]');
  await click('#help-button'); assert.ok(await evaluate('document.getElementById("help-dialog").open'));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.help-keys kbd')].map(k=>k.textContent)`), ['S','D','F','J','K','L']);
  await screenshot('08-v1-six-key-help'); await click('#help-dialog [data-close]');
  await click('#start-button'); await until('document.body.dataset.screen === "game"');
  const sixComboBaseline = await comboCount();
  const widths = await evaluate(`[...document.querySelectorAll('[data-lane]')].map(b=>b.getBoundingClientRect().width)`);
  assert.ok(widths.every(width=>width >= 44 && Math.abs(width-widths[0]) < 1), 'Six lanes must be evenly laid out and operable');
  await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'s',code:'KeyS',windowsVirtualKeyCode:83});
  assert.ok(await evaluate(`document.querySelector('[data-lane="0"]').classList.contains('pressed')`));
  await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'s',code:'KeyS',windowsVirtualKeyCode:83,autoRepeat:true});
  assert.equal((await snapshot()).score, 0);
  await cdp('Input.dispatchKeyEvent', {type:'keyUp',key:'s',code:'KeyS',windowsVirtualKeyCode:83});
  assert.ok(await evaluate(`!document.querySelector('[data-lane="0"]').classList.contains('pressed')`));
  await check('six-key experimental selection, six equal lanes and hold/release contract');
  const sixChart = await evaluate(`import('/src/modes.js').then(m=>m.createSixKeyChart())`), sixKeys = ['KeyS','KeyD','KeyF','KeyJ','KeyK','KeyL'];
  if (pageScheduledInputs) await schedulePageInputs(sixChart.map(note => ({ time: note.time, codes: [sixKeys[note.lane]] })));
  let sixInputs=0,sixShot=false;
  for (const note of sixChart) {
    assert.equal((await snapshot()).paused, false);
    if (pageScheduledInputs) await until(`window.__demoAudit.scheduledInputs >= ${sixInputs + 1}`);
    else { await waitForNote(note.time); await key(sixKeys[note.lane]); }
    sixInputs++;
    if(!sixShot&&sixInputs>=10){await screenshot('04-v1-six-key-experiment');sixShot=true;}
  }
  await until('document.body.dataset.screen === "result"',12000);
  const sixFinal=await evaluate(`({score:Number(document.getElementById('result-score').textContent.replaceAll(',','')),accuracy:parseFloat(document.getElementById('result-accuracy').textContent),combo:Number(document.getElementById('result-combo').textContent),label:document.getElementById('result-difficulty').textContent,counts:Object.fromEntries(['perfect','great','good','miss'].map(k=>[k,Number(document.getElementById('result-'+k).textContent)]))})`);
  assert.equal(Object.values(sixFinal.counts).reduce((a,b)=>a+b,0),sixChart.length);assert.equal(sixFinal.counts.miss,0);assert.equal(sixFinal.combo,sixChart.length);assert.match(sixFinal.label,/6 KEY.*실험/);
  const sixWeight=sixFinal.counts.perfect+sixFinal.counts.great*.7+sixFinal.counts.good*.3;
  assert.equal(sixFinal.score,Math.round(sixWeight/sixChart.length*1000000));assert.ok(Math.abs(sixFinal.accuracy-sixWeight/sixChart.length*100)<=.0051);
  assert.ok(await evaluate(`![...document.querySelectorAll('[data-lane]')].some(b=>b.classList.contains('pressed'))`));
  assert.equal(await comboCount() - sixComboBaseline,2,'Six-key song plays cues only at 10 and 50 combo');
  await screenshot('05-v1-six-key-results');await check('six-key real-time whole song and independent score oracle',{notes:sixChart.length,automatedInputs:sixInputs,inputDriver:report.inputDriver,final:sixFinal});
  await click('#retry-button');await until('document.body.dataset.screen === "game"');assert.deepEqual((await snapshot()).counts,countsZero);assert.equal((await snapshot()).score,0);assert.equal((await snapshot()).elapsed,'00:00');
  await key('Escape');await until('document.getElementById("pause-dialog").open');await click('#quit-button');await until('document.body.dataset.screen === "menu"');
  const stored=await evaluate(`JSON.parse(localStorage.getItem('pulse-shift-records'))`);
  assert.equal(stored['afterglow:6k:easy'].score,sixFinal.score);assert.equal(stored['afterglow:easy'].score,500000);assert.equal(stored['tidal-circuit:4k:normal'].score,final.score);
  await click('button[data-key-count="4"]');assert.equal(await evaluate('document.getElementById("best-score").textContent'),'500,000');await navigate();assert.equal(await evaluate('document.body.dataset.keyCount'),'4');
  await key('ArrowRight');assert.ok(await evaluate(`document.querySelector('button[data-key-count="6"]').disabled`));assert.equal(await evaluate('document.body.dataset.keyCount'),'4');
  await check('six-key retry, reload persistence, legacy 4-key record and Tidal exclusion');

  // Presentation-specific layout checks use this same isolated browser.
  await click('#start-button'); await until('document.body.dataset.screen === "game"');
  const stageInfo = await evaluate(`(()=>{let cover=document.getElementById('stage-cover'),art=document.querySelector('.play-song>img');return{cover:cover.getAttribute('src'),loaded:cover.complete&&cover.naturalWidth>0,opacity:getComputedStyle(cover).opacity,artRatio:art.getBoundingClientRect().width/art.getBoundingClientRect().height}})()`);
  assert.equal(stageInfo.cover,'/assets/tidal-circuit.svg');assert.equal(stageInfo.loaded,true);assert.equal(stageInfo.opacity,'0.28');assert.ok(Math.abs(stageInfo.artRatio-1)<.01);
  await check('album cover follows Tidal, stays translucent and preserves the square card',{stageInfo});
  const layout = () => evaluate(`({viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,keys:[...document.querySelectorAll('[data-lane]')].map(b=>{let r=b.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}),pause:(()=>{let r=document.getElementById('pause-button').getBoundingClientRect();return{width:r.width,height:r.height}})()})`);
  for(const [width,height,name] of [[375,812,'portrait'],[844,390,'landscape']]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const bounds=await layout();
    assert.equal(bounds.documentWidth,width,'No horizontal overflow');
    assert.ok(bounds.keys.every(b=>b.width>=44&&b.height>=44&&b.x>=0&&b.right<=width&&b.y>=0&&b.bottom<=height),'Input keys must be on screen and operable');
    assert.ok(bounds.pause.width>=44&&bounds.pause.height>=44);
    await screenshot(`10-stage-${name}`); await check(`responsive stage ${name}`,{bounds});
  }
  await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".countdown")).textShadow'),'none');
  await cdp('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false});
  await key('Escape');await until('document.getElementById("pause-dialog").open');await click('#quit-button');await until('document.body.dataset.screen === "menu"');
  await key('ArrowLeft');await click('button[data-key-count="6"]');await click('#start-button');await until('document.body.dataset.screen === "game"');
  const sixBounds=await layout();assert.equal(sixBounds.keys.length,6);assert.ok(sixBounds.keys.every(b=>b.width>=44&&b.height>=44&&b.right<=375));
  assert.equal(await evaluate('document.getElementById("stage-cover").getAttribute("src")'),'/assets/afterglow.svg');
  await screenshot('11-stage-six-key-portrait');await check('six-key small-screen controls and reduced-motion presentation',{bounds:sixBounds});
  await key('Escape');await until('document.getElementById("pause-dialog").open');await click('#quit-button');await until('document.body.dataset.screen === "menu"');
  await click('button[data-key-count="4"]');await cdp('Emulation.setEmulatedMedia',{features:[]});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});

  expectedFault = 'external SFX blocked'; await cdp('Fetch.enable', { patterns: [{ urlPattern: '*assets/sfx/*', requestStage: 'Request' }] });
  await navigate(); await click('#settings-button'); await click('#combo-preview-button');
  await until('!document.getElementById("combo-preview-button").disabled');
  assert.equal(await comboCount(), 1); assert.equal((await snapshot()).toast, null);
  await check('procedural combo preview works with all external SFX blocked');
  await cdp('Fetch.disable'); expectedFault = null;
  expectedFault = 'synthesis worker intentionally missing'; await cdp('Fetch.enable', { patterns: [{ urlPattern: '*src/synth-worker.js', requestStage: 'Request' }] }); await navigate(); await click('#start-button'); await until('!document.getElementById("menu-error").hidden && !document.getElementById("start-button").disabled'); assert.equal((await snapshot()).screen, 'menu'); assert.match((await snapshot()).menuError, /음악을 불러오지 못/); await check('missing required synthesis worker fails safely with retry available'); await cdp('Fetch.disable'); expectedFault = null;
  await click('#start-button'); await until('document.body.dataset.screen === "game"'); await check('retry recovers after required asset becomes available');
  await key('Escape'); await until('document.getElementById("pause-dialog").open'); await click('#quit-button'); await until('document.body.dataset.screen === "menu"');
  const errors = evidence.filter(item => item.method === 'Runtime.exceptionThrown' || item.method === 'Log.entryAdded' && item.params.entry.level === 'error' || item.method === 'Network.loadingFailed' || item.method === 'Network.responseReceived' && item.params.response.status >= 400);
  report.expectedLoadErrors = errors.filter(item => item.expectedFault);
  report.unexpectedErrors = errors.filter(item => !item.expectedFault);
  assert.deepEqual(report.unexpectedErrors, [], 'Unexpected console, page or asset errors; see report.json');
  assert.ok(!evidence.some(item=>item.method==='Network.requestWillBeSent'&&/\/(analysis(?:-worker)?\.js|assets\/my-music\.svg)(?:$|\?)/.test(item.params.request.url)), 'Removed import modules/assets must never load');
  assert.ok(!evidence.some(item=>item.method==='Network.requestWillBeSent'&&item.params.request.url.includes('/assets/sfx/')), 'Procedural feedback must not request external sound files');
  report.status = 'passed'; log('PASS no unexpected console or asset failures');
} catch (error) {
  report.status = 'failed'; report.failure = String(error); process.exitCode = 1;
  try { report.failureSnapshot = await snapshot(); report.timingDiagnostics = await evaluate('({inputs:window.__demoAudit.inputs,judgments:window.__demoAudit.judgments,longTasks:window.__demoAudit.longTasks})'); report.focusEvents = await evaluate('window.__demoAudit.events.slice(-40)'); await screenshot('failure'); } catch {}
  console.error(error);
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'server.txt'), serverLog); await writeFile(join(output, 'chrome.txt'), chromeLog);
  await writeFile(join(root, 'artifacts', 'demo-qa', 'latest.json'), JSON.stringify({ status: report.status, directory: output, report: join(output, 'report.json') }, null, 2));
  if (socket?.readyState === 1) { try { await cdp('Browser.close'); } catch {} socket.close(); }
  chrome?.kill(); server?.kill();
  log(`${report.status.toUpperCase()} — ${join(output, 'report.json')}`);
}
