// Test the real unpacked application with a disposable profile. No model or Arena calls.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { createHash } = require('node:crypto');
const { packageLayout } = require('./package-layout.cjs');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const root = path.resolve(__dirname, '..');
const requested = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const { executable, resources, backend: backendExecutable } = packageLayout(root, process.platform, process.arch, requested);
assert.ok(fs.existsSync(executable), 'Packaged executable is missing: ' + executable);
const directory = path.join(root, 'work', 'packaged-smoke', randomUUID());
fs.mkdirSync(directory, { recursive: true });
const assertions = [];
const check = (value, message) => { assert.ok(value, message); assertions.push(message); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
async function until(fn) {
  const end = Date.now() + 65000;
  while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch {} await sleep(300); }
  throw new Error('Timed out waiting for packaged workspace');
}
async function cdp(url) {
  const socket = new WebSocket(url), pending = new Map(); let sequence = 0;
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = event => {
    const message = JSON.parse(event.data); if (!message.id) return;
    const entry = pending.get(message.id); if (!entry) return; pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { send, close: () => socket.close(), evaluate: async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  } };
}
let child, browser, apiPort, rendererPort;
async function stop(graceful = false) {
  if (!child) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  if (graceful && browser) {
    await Promise.race([browser.send('Browser.close').catch(() => {}), sleep(2000)]);
    await Promise.race([exited, sleep(8000)]);
  }
  browser?.close(); browser = null;
  const normalExit = child.exitCode !== null;
  if (!normalExit) {
    if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGTERM'); // the test owns this detached process group
    await Promise.race([exited, sleep(5000)]);
  }
  child = null;
  if (graceful) assert.ok(normalExit, 'Packaged application must exit normally so Chromium can flush its profile');
}
async function launch() {
  const debug = await port();
  apiPort ||= await port(); rendererPort ||= await port();
  const api = apiPort, renderer = rendererPort;
  const env = { ...process.env, MRGOOSE_DATA_DIR: path.join(directory, 'data'), MRGOOSE_BACKEND_URL: `http://127.0.0.1:${api}`,
    MRGOOSE_RENDERER_PORT: String(renderer), DOTNET_ROOT: path.join(directory, 'no-dotnet-installed'),
    PATH: process.platform === 'win32' ? `${process.env.SystemRoot}\\System32` : '/usr/bin:/bin' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.MRGOOSE_RENDERER_URL; delete env.MRGOOSE_DB_PATH;
  const log = fs.openSync(path.join(directory, `launch-${debug}.log`), 'a');
  child = spawn(executable, [`--remote-debugging-port=${debug}`], { cwd: directory, env, detached: process.platform === 'darwin', windowsHide: true, stdio: ['ignore', log, log] });
  child.on('error', error => { fs.appendFileSync(path.join(directory, 'spawn-error.log'), error.message); });
  fs.closeSync(log);
  const target = await until(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debug}/json/list`)).json();
    return targets.find(t => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${renderer}`));
  });
  browser = await cdp(target.webSocketDebuggerUrl);
  await until(() => browser.evaluate("document.body.innerText.includes('hub connected') && document.body.innerText.includes('backend ok')"));
  return browser;
}
(async () => {
  try {
    await launch();
    const info = await browser.evaluate('window.mrgoose.app.info()');
    check(info.packaged === true, 'Actual packaged Electron application opened with backend and hub connected');
    check(info.version === require('../package.json').version, 'Displayed version matches the package');
    check(fs.existsSync(path.join(directory, 'data', 'mrgoose.db')), 'SQLite is in the disposable data directory, outside installed resources');
    check(!fs.existsSync(path.join(resources, 'backend', 'mrgoose.db')), 'Packaged backend contains no user database');
    const wrappedKey = path.join(directory, 'data', 'key-encryption.bin');
    let wrappedKeyHash;
    if (process.platform === 'darwin') {
      check(fs.existsSync(wrappedKey), 'macOS startup persisted an OS-Keychain-wrapped desktop key');
      wrappedKeyHash = createHash('sha256').update(fs.readFileSync(wrappedKey)).digest('hex');
    }
    const mcp = await browser.evaluate('window.mrgoose.mcp.status()');
    check(mcp.env.MRGOOSE_MCP_DIRECTORY === path.join(directory, 'data', 'mcp'), 'Packaged MCP configuration points to the installed profile');
    const transport = new StdioClientTransport({ command: mcp.command, args: mcp.args, env: { ...process.env, ...mcp.env }, stderr: 'pipe' });
    const client = new Client({ name: 'packaged-smoke', version: '1.0.0' });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'mrgoose_status', arguments: {} });
      check(!result.isError, 'Packaged executable can run the bundled ASAR MCP adapter without Node installation');
      if (process.argv.includes('--ui')) {
        for (const route of ['sources', 'prompts', 'techniques', 'challenges', 'settings', 'organizer']) {
          await browser.send('Page.navigate', { url: `http://127.0.0.1:${rendererPort}/${route}` });
          await until(() => browser.evaluate(`location.pathname === '/${route}' && !!document.querySelector('.page h1') && document.body.innerText.includes('hub connected')`));
          check(true, `Installed ${route} page loads with its backend connection`);
        }
        const technique = await browser.evaluate("fetch(window.mrgoose.backendUrl+'/api/techniques',{method:'POST',headers:{Authorization:'Bearer '+window.mrgoose.backendToken,'Content-Type':'application/json'},body:JSON.stringify({title:'Installer technique fixture',summary:'Fixture summary',whenItWorks:'Preserve this applicability',example:'Fixture',tags:'indirect'})}).then(r=>r.json())");
        const opened = await client.callTool({ name: 'organizer_run', arguments: { tool: 'open_in_view', args: { kind: 'technique', id: String(technique.id) } } });
        check(!opened.isError, 'Installed MCP opens the requested item in the Inspector');
        await until(() => browser.evaluate("document.querySelector('.inspector-panel input')?.value === 'Installer technique fixture'"));
        await browser.evaluate("(()=>{const input=document.querySelector('.inspector-panel input'); input.value='Renamed installer fixture';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
        await until(() => browser.evaluate("document.querySelector('.inspector-foot button')?.disabled === false"));
        await browser.evaluate("document.querySelector('.inspector-foot button').click()");
        await until(() => browser.evaluate("fetch(window.mrgoose.backendUrl+'/api/techniques',{headers:{Authorization:'Bearer '+window.mrgoose.backendToken}}).then(r=>r.json()).then(rows=>rows.some(t=>t.title==='Renamed installer fixture' && t.whenItWorks==='Preserve this applicability'))"));
        check(true, 'Installed Inspector saves edits without erasing applicability');
        await browser.send('Page.navigate', { url: `http://127.0.0.1:${rendererPort}/settings` });
        await until(() => browser.evaluate("document.querySelector('[aria-label=\"Application version and updates\"]')?.innerText.includes('Check for updates')"));
        check(true, 'Installed Settings displays app version and update controls');
        if (process.argv.includes('--check-feed')) {
          const update = await browser.evaluate('window.mrgoose.app.checkUpdate()');
          check(['current', 'available', 'error'].includes(update.state), 'Real update check returns a definite result without downloading or installing');
          fs.writeFileSync(path.join(directory, 'update-check.json'), JSON.stringify(update, null, 2));
        }
        await browser.send('Page.navigate', { url: `http://127.0.0.1:${rendererPort}/workbench` });
        await until(() => browser.evaluate("document.body.innerText.includes('Break Workbench') && document.body.innerText.includes('hub connected')"));
      }
    } finally { await client.close(); }
    await browser.evaluate("localStorage.setItem('distribution-smoke','persisted'); fetch(window.mrgoose.backendUrl + '/api/prompts', { method:'POST',headers:{Authorization:'Bearer '+window.mrgoose.backendToken,'Content-Type':'application/json'},body:JSON.stringify({title:'Distribution smoke fixture',body:'Fixture only'})}).then(r=>{if(!r.ok)throw Error('save');return true})");
    const screenshot = await browser.send('Page.captureScreenshot');
    fs.writeFileSync(path.join(directory, 'workspace.png'), Buffer.from(screenshot.data, 'base64'));
    await stop(true); await sleep(1500); await launch();
    check(await browser.evaluate("localStorage.getItem('distribution-smoke') === 'persisted'"), 'Browser history/local storage survives application restart');
    if (process.platform === 'darwin') check(createHash('sha256').update(fs.readFileSync(wrappedKey)).digest('hex') === wrappedKeyHash, 'macOS restart unlocks the existing wrapped key without replacing it');
    check(await browser.evaluate("fetch(window.mrgoose.backendUrl+'/api/prompts',{headers:{Authorization:'Bearer '+window.mrgoose.backendToken}}).then(r=>r.json()).then(rows=>rows.some(p=>p.title==='Distribution smoke fixture'))"), 'Library records survive application restart');
    const { listPackage } = await import('@electron/asar');
    const entries = listPackage(path.join(resources, 'app.asar'));
    check(!entries.some(file => /^[\\/](work|data|reference|MrGoose-Knowledge|tests|client|backend)[\\/]/.test(file)), 'ASAR allowlist excludes personal data, research corpus, source trees and project test fixtures');
    await stop(true);
    // Exercise explicit import with synthetic checkout data and the bundled backup utility.
    const source = path.join(directory, 'source-checkout'), imported = path.join(directory, 'imported-data');
    const sourceDb = path.join(source, 'backend', 'bin', 'Debug', 'net10.0', 'mrgoose.db');
    fs.mkdirSync(path.dirname(sourceDb), { recursive: true });
    const backup = spawnSync(backendExecutable, ['--backup-database', path.join(directory, 'data', 'mrgoose.db'), sourceDb], { windowsHide: true });
    assert.equal(backup.status, 0, 'Bundled SQLite backup utility must succeed');
    fs.mkdirSync(path.join(source, 'data', 'desktop'), { recursive: true });
    fs.writeFileSync(path.join(source, 'data', 'desktop', 'fixture.txt'), 'Profile fixture');
    const migrationArgs = [path.join(root, 'scripts', 'migrate-data.cjs'), '--from', source, '--to', imported, '--backend', backendExecutable, '--apps-closed'];
    const migration = spawnSync(process.execPath, migrationArgs, { windowsHide: true });
    assert.equal(migration.status, 0, migration.stderr?.toString());
    const { DatabaseSync } = require('node:sqlite');
    const importedDb = new DatabaseSync(path.join(imported, 'mrgoose.db'), { readOnly: true });
    try { check(importedDb.prepare('SELECT COUNT(*) AS count FROM Prompts WHERE Title=?').get('Distribution smoke fixture').count === 1, 'Checkout import preserves exact library records'); }
    finally { importedDb.close(); }
    check(fs.readFileSync(path.join(imported, 'desktop', 'fixture.txt'), 'utf8') === 'Profile fixture', 'Checkout import preserves the profile');
    check(spawnSync(process.execPath, migrationArgs, { windowsHide: true }).status !== 0 && fs.existsSync(sourceDb), 'Import refuses to overwrite installed data and preserves the source');
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ platform: process.platform, arch: process.arch, assertions, fixtureOnly: true, paidCalls: 0, submissions: 0 }, null, 2));
    console.log(JSON.stringify({ passed: assertions.length, report: path.join(directory, 'report.json'), screenshot: path.join(directory, 'workspace.png') }));
  } finally { await stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
