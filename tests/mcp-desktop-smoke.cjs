// Node launcher + Electron driver. Copies the app to a fresh local scratch checkout,
// starts the real main/preload/Angular/backend wiring, and leaves operator sessions untouched.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  (async () => {
    const http = require('node:http');
    const { spawn } = require('node:child_process');
    const snapshot = path.join(root, 'work', 'mcp-desktop-smoke', randomUUID());
    fs.mkdirSync(snapshot, { recursive: true });
    for (const folder of ['electron', 'mcp']) fs.cpSync(path.join(root, folder), path.join(snapshot, folder), { recursive: true });
    const backend = path.join(snapshot, 'backend', 'bin', 'Debug', 'net10.0');
    fs.cpSync(path.join(root, 'work', 'mcp-increment', 'backend'), backend, { recursive: true, filter: file => !/\.db(?:-|\.|$)/.test(file) });
    const clientRoot = path.join(root, 'work', 'mcp-increment', 'client', 'browser');
    const renderer = http.createServer((req, res) => {
      const relative = new URL(req.url, 'http://local').pathname;
      let file = path.resolve(clientRoot, '.' + decodeURIComponent(relative));
      if (!file.startsWith(clientRoot + path.sep)) file = path.join(clientRoot, 'index.html');
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(clientRoot, 'index.html');
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => renderer.listen(0, '127.0.0.1', resolve));
    const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const environment = { ...process.env, Logging__LogLevel__Default: 'Warning', MRGOOSE_TEST_SNAPSHOT: snapshot, MRGOOSE_BACKEND_URL: `http://127.0.0.1:${port}`, MRGOOSE_RENDERER_URL: `http://127.0.0.1:${renderer.address().port}` };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [__filename], { cwd: root, env: environment, windowsHide: true, stdio: 'inherit' });
    child.on('error', error => { renderer.close(); throw error; });
    child.on('exit', code => { renderer.close(); process.exitCode = code || (fs.existsSync(path.join(snapshot, 'passed.json')) ? 0 : 1); });
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  const { Client } = require('@modelcontextprotocol/client');
  const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
  const snapshot = process.env.MRGOOSE_TEST_SNAPSHOT;
  require(path.join(snapshot, 'electron', 'main.js'));
  let client;
  app.whenReady().then(async () => {
    let arenaPopup;
    for (let i = 0; i < 160; i++) {
      arenaPopup = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/arena-window.html'));
      if (arenaPopup) { try { await arenaPopup.webContents.executeJavaScript('window.arenaWindow.list()'); break; } catch {} }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(arenaPopup, 'Hidden Arena host did not initialize');
    assert.equal(arenaPopup.isVisible(), false, 'Normal app startup must not display the Arena popup');
    let cockpit;
    for (let i = 0; i < 240; i++) {
      cockpit = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith(process.env.MRGOOSE_RENDERER_URL));
      if (cockpit) {
        try { if (cockpit.isVisible() && await cockpit.webContents.executeJavaScript("!!window.mrgoose?.mcp && document.body.innerText.includes('backend ok')")) break; } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(cockpit, 'Real cockpit did not start');
    assert.equal(cockpit.isVisible(), true, 'Normal app startup must display the workspace');
    const management = await cockpit.webContents.executeJavaScript('window.mrgoose.mcp.status()');
    assert.equal(management.enabled, true);
    const pair = management;
    client = new Client({ name: 'desktop-wiring-check', version: '1' });
    const transport = new StdioClientTransport({ command: pair.command, args: pair.args, env: { ...process.env, ...pair.env }, stderr: 'pipe' });
    await client.connect(transport);
    const result = await client.callTool({ name: 'library_search', arguments: { collection: 'techniques' } });
    assert.notEqual(result.isError, true); assert.ok(JSON.parse(result.content[0].text).hits.length >= 5);
    assert.equal(arenaPopup.isVisible(), false, 'MCP library access must not display the Arena popup');
    await cockpit.webContents.executeJavaScript("document.querySelector('a[href=\"/settings\"]').click()");
    for (let i = 0; i < 40; i++) {
      if (await cockpit.webContents.executeJavaScript("document.body.innerText.includes('Local access is automatic')")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const rendered = await cockpit.webContents.executeJavaScript("({url:location.href,text:document.body.innerText})");
    fs.writeFileSync(path.join(snapshot, 'settings-text.txt'), rendered.text);
    fs.writeFileSync(path.join(snapshot, 'desktop.png'), (await cockpit.webContents.capturePage()).toPNG());
    assert.ok(rendered.text.includes('Local access is automatic') && !rendered.text.includes('authorize local client'), 'Settings automatic local access did not render: ' + rendered.url);
    fs.writeFileSync(path.join(snapshot, 'desktop.png'), (await cockpit.webContents.capturePage()).toPNG());
    cockpit.close(); assert.equal(cockpit.isDestroyed(), false); assert.equal(cockpit.isVisible(), false);
    const hidden = await client.callTool({ name: 'mrgoose_status', arguments: {} }); assert.notEqual(hidden.isError, true);
    assert.equal(arenaPopup.isVisible(), false, 'Workspace hide and MCP status must not open Arena');
    app.emit('second-instance', {}, [process.execPath, 'electron/main.js']);
    for (let i = 0; i < 20 && !cockpit.isVisible(); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(cockpit.isVisible(), true, 'Reopening the app must restore workspace');
    assert.equal(arenaPopup.isVisible(), false, 'Reopening the app must not restore Arena instead');
    fs.writeFileSync(path.join(snapshot, 'passed.json'), JSON.stringify({ passed: true, checks: ['normal startup shows workspace', 'Arena remains hidden', 'automatic local access', 'MCP library read without popup', 'second-instance restores workspace', 'close-to-hide'] }));
    console.log('PASS: normal startup/reopen shows workspace; Arena stays hidden during startup and MCP data reads; automatic local access and Settings work. Screenshot: ' + path.join(snapshot, 'desktop.png'));
  }).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { try { await client?.close(); } finally { app.quit(); setTimeout(() => app.exit(process.exitCode || 0), 300); } });
}
