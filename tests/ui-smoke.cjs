// Whole-app UI smoke for the DEV build. Launches a disposable Mr Goose (own data dir + ports, so it
// runs alongside a running `npm run dev`), drives the renderer over CDP (no Playwright/Puppeteer), walks
// every route, exercises the core interactions, and fails on ANY uncaught exception or console.error.
//
// Prereqs (the app the test boots): the dev backend built + the client dist built.
//   dotnet build backend/MrGoose.Backend.csproj -c Debug   &&   npm --prefix client run build
// Run:  node tests/ui-smoke.cjs        (it never submits/launches anything — read + fill only)
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const electronBin = require('electron');                       // path to the Electron binary (devDependency)
const backendExe = path.join(root, 'backend', 'bin', 'Debug', 'net10.0',
  process.platform === 'win32' ? 'MrGoose.Backend.exe' : 'MrGoose.Backend');
const distIndex = path.join(root, 'client', 'dist', 'client', 'browser', 'index.html');
assert.ok(fs.existsSync(backendExe), `Dev backend missing — run: dotnet build backend/MrGoose.Backend.csproj -c Debug\n  (${backendExe})`);
assert.ok(fs.existsSync(distIndex), `Client dist missing — run: npm --prefix client run build\n  (${distIndex})`);

const directory = path.join(root, 'work', 'ui-smoke', randomUUID());
fs.mkdirSync(directory, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const passed = [];
const check = (value, message) => { assert.ok(value, message); passed.push(message); };

async function freePort() {
  const server = net.createServer();
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const p = server.address().port;
  await new Promise(res => server.close(res));
  return p;
}
async function until(fn, ms = 60000, label = 'condition') {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fn(); if (r) return r; } catch { /* retry */ } await sleep(300); }
  throw new Error('Timed out waiting for ' + label);
}

// ── minimal CDP client (responses by id + fan-out of events) ──
async function cdp(url, onEvent) {
  const socket = new WebSocket(url), pending = new Map(); let seq = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id) { const e = pending.get(m.id); if (!e) return; pending.delete(m.id); m.error ? e.reject(new Error(m.error.message)) : e.resolve(m.result); }
    else if (onEvent) onEvent(m.method, m.params);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  return {
    send, close: () => socket.close(),
    async evaluate(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
  };
}

let child, browser, step = 'startup';
const errors = [];                       // {step, text} — console.error + uncaught exceptions
const IGNORE = [];                       // benign substrings to tolerate (none yet)
function record(text) { if (text && !IGNORE.some(s => text.includes(s))) errors.push({ step, text: String(text).slice(0, 400) }); }

function onEvent(method, params) {
  if (method === 'Runtime.exceptionThrown') record(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text);
  else if (method === 'Runtime.consoleAPICalled' && params.type === 'error')
    record((params.args || []).map(a => a.description || a.value || a.unserializableValue || '').join(' '));
}

async function launch() {
  const debug = await freePort(), api = await freePort(), renderer = await freePort();
  const env = { ...process.env, MRGOOSE_DATA_DIR: path.join(directory, 'data'),
    MRGOOSE_BACKEND_URL: `http://127.0.0.1:${api}`, MRGOOSE_RENDERER_PORT: String(renderer) };
  delete env.ELECTRON_RUN_AS_NODE; delete env.MRGOOSE_RENDERER_URL; delete env.MRGOOSE_DB_PATH;
  const log = fs.openSync(path.join(directory, 'electron.log'), 'a');
  child = spawn(electronBin, [`--remote-debugging-port=${debug}`, 'electron/main.js'],
    { cwd: root, env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', log, log] });
  child.on('error', e => fs.appendFileSync(path.join(directory, 'spawn-error.log'), e.message));
  fs.closeSync(log);
  const target = await until(async () => {
    const list = await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json();
    return list.find(t => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${renderer}`));
  }, 90000, 'cockpit page');
  browser = await cdp(target.webSocketDebuggerUrl, onEvent);
  await browser.send('Runtime.enable');
  await until(() => browser.evaluate("document.body.innerText.includes('hub connected') && document.body.innerText.includes('backend ok')"), 60000, 'backend+hub');
  return renderer;
}
function stop() {
  try { browser?.close(); } catch { /* */ }
  if (child && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* */ } }
  }
}

const ROUTES = ['organizer', 'sources', 'prompts', 'techniques', 'challenges', 'workbench', 'settings'];

async function go(renderer, route) {
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${renderer}/${route}` });
  await until(() => browser.evaluate(`location.pathname === '/${route}' && !!document.querySelector('.page h1')`), 20000, `/${route}`);
}
function clickText(text) {
  return browser.evaluate(`(()=>{const t=${JSON.stringify(text)};const el=[...document.querySelectorAll('button,a,.chip,[role=button]')].find(e=>{const s=(e.textContent||'').trim();return s===t||s.startsWith(t);});if(!el)return false;el.click();return true;})()`);
}

(async () => {
  const renderer = await launch();
  check(true, 'Disposable dev app booted with backend + hub connected');

  // ── 1) every route renders, with zero console errors/exceptions ──
  for (const route of ROUTES) {
    step = `route:${route}`;
    const before = errors.length;
    await go(renderer, route);
    await sleep(500);                                  // let late async render/log settle
    check(await browser.evaluate("!!document.querySelector('.page h1')"), `/${route} renders (.page h1)`);
    check(errors.length === before, `/${route} produced no console errors`);
  }

  // ── 1b) Settings tab: per-role model settings render (organizer + attacker), mirrored in their tabs ──
  step = 'settings:roles';
  await go(renderer, 'settings');
  check(await browser.evaluate("document.querySelectorAll('mg-model-settings').length >= 2"), 'Settings shows per-role model settings (organizer + attacker)');
  check(await browser.evaluate("!!document.querySelector('mg-model-settings select')"), 'model settings expose a reasoning control');

  // ── 2) workbench tabs switch ──
  step = 'workbench:tabs';
  await go(renderer, 'workbench');
  check(await browser.evaluate("document.querySelectorAll('.stat-card').length >= 4"), 'Overview shows the stat cards');
  for (const label of ['Overview', 'Recon', 'Find Break']) {
    check(await clickText(label), `workbench tab "${label}" is clickable`);
    await until(() => browser.evaluate(`document.querySelector('nav button[aria-pressed="true"]')?.textContent.trim() === ${JSON.stringify(label)}`), 8000, `tab ${label} active`);
  }

  // ── 3) batch card (multi-tab) present + safe to operate without a craft ──
  step = 'workbench:batch';
  await until(() => browser.evaluate("!!document.querySelector('.batch-actions')"), 8000, 'batch card');
  check(true, 'Batch multi-tab card renders on Find Break');
  check(await browser.evaluate("!!document.querySelector('.builder-card')"), 'Multi-surface injection builder renders on Find Break');
  check(await clickText('+ add current'), '"+ add current" is clickable (guards gracefully with no craft)');
  await clickText('Clear');
  check(true, 'batch add/clear run without errors');

  // ── 4) an overlay opens and closes ──
  step = 'workbench:overlay';
  check(await clickText('Reference prompts'), 'a craft-context button is clickable');
  await until(() => browser.evaluate("!!document.querySelector('.overlay-back, .tool-dialog')"), 8000, 'overlay open');
  check(true, 'a workbench overlay opens');
  await browser.evaluate("document.querySelector('.overlay-back')?.click()");
  await until(() => browser.evaluate("!document.querySelector('.tool-dialog')"), 8000, 'overlay closed');
  check(true, 'the overlay closes');

  // ── 5) inspector: open a technique, edit it, save it ──
  step = 'organizer:inspector';
  await go(renderer, 'organizer');
  check(await browser.evaluate("document.querySelectorAll('.quick-actions button').length >= 6"), 'Organizer quick-action buttons render');
  check(await clickText('+ add'), 'the "+ add" quick-action button is clickable');
  await until(() => browser.evaluate("!!document.querySelector('.qa-editor')"), 8000, 'quick-action editor');
  check(true, 'adding a quick-action opens the editor');
  await browser.evaluate("[...document.querySelectorAll('.qa-editor button')].find(b => (b.textContent||'').trim()==='Close')?.click()");
  const techId = await browser.evaluate("fetch(window.mrgoose.backendUrl+'/api/techniques',{method:'POST',headers:{Authorization:'Bearer '+window.mrgoose.backendToken,'Content-Type':'application/json'},body:JSON.stringify({title:'UI smoke fixture',summary:'s',whenItWorks:'keep-this',example:'e',tags:'indirect'})}).then(r=>r.json()).then(t=>t.id)");
  check(!!techId, 'created a technique fixture via the API');
  await browser.evaluate(`fetch(window.mrgoose.backendUrl+'/api/control/organizer_run',{method:'POST',headers:{Authorization:'Bearer '+window.mrgoose.backendToken,'Content-Type':'application/json'},body:JSON.stringify({tool:'open_in_view',args:{kind:'technique',id:String(${techId})}})})`);
  await until(() => browser.evaluate("document.querySelector('.inspector-panel input')?.value === 'UI smoke fixture'"), 10000, 'inspector shows the technique');
  check(true, 'open_in_view surfaces the technique in the Inspector');
  await browser.evaluate("(()=>{const i=document.querySelector('.inspector-panel input');i.value='UI smoke renamed';i.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await until(() => browser.evaluate("document.querySelector('.inspector-foot button')?.disabled === false"), 8000, 'save enabled');
  await browser.evaluate("document.querySelector('.inspector-foot button').click()");
  await until(() => browser.evaluate("fetch(window.mrgoose.backendUrl+'/api/techniques',{headers:{Authorization:'Bearer '+window.mrgoose.backendToken}}).then(r=>r.json()).then(rows=>rows.some(t=>t.title==='UI smoke renamed' && t.whenItWorks==='keep-this'))"), 10000, 'edit persisted');
  check(true, 'Inspector saves edits (and keeps "When it works")');

  // ── 6) MCP path: organizer_run create_technique honours requiresEncoding ──
  step = 'mcp:requiresEncoding';
  const encOk = await browser.evaluate("(async()=>{const h={Authorization:'Bearer '+window.mrgoose.backendToken,'Content-Type':'application/json'};await fetch(window.mrgoose.backendUrl+'/api/control/organizer_run',{method:'POST',headers:h,body:JSON.stringify({tool:'create_technique',args:{title:'MCP enc fixture',tags:'encoding',requiresEncoding:true}})});const rows=await fetch(window.mrgoose.backendUrl+'/api/techniques',{headers:h}).then(r=>r.json());return rows.some(t=>t.title==='MCP enc fixture'&&t.requiresEncoding===true);})()");
  check(encOk, 'organizer_run create_technique persists requiresEncoding (MCP wiring)');

  // ── final: no console errors anywhere ──
  step = 'final';
  await sleep(400);
  if (errors.length) { console.error('\nConsole errors / exceptions:'); for (const e of errors) console.error(`  [${e.step}] ${e.text}`); }
  check(errors.length === 0, `no console errors or uncaught exceptions across the whole UI (${errors.length} seen)`);

  console.log(`\n✓ UI smoke passed — ${passed.length} checks`);
})()
  .then(() => { stop(); process.exit(0); })
  .catch(err => { console.error('\n✗ UI smoke failed:', err.message); if (errors.length) for (const e of errors) console.error(`  [${e.step}] ${e.text}`); stop(); process.exit(1); });
