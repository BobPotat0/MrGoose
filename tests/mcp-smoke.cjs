// Execute with Electron, not node. Real SDK stdio → broker → Electron WebContents + isolated backend.
// Only a localhost fixture is loaded. No Arena session, real database or model is used.
const { app, BrowserWindow, WebContentsView, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/client');
const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
const { ArenaBrowserService } = require('../electron/arena-browser-service');
const { LocalControl } = require('../electron/local-control');
const { createArenaWindow } = require('../electron/arena-window');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'work', 'mcp-smoke', randomUUID());
fs.mkdirSync(directory, { recursive: true });
fs.mkdirSync(path.join(directory, 'profile'), { recursive: true });
app.setPath('userData', path.join(directory, 'profile'));
app.setPath('sessionData', path.join(directory, 'profile'));
let backend, fixture, window, control, popup;
const clients = [];
const report = { assertions: [], fixtureOnly: true, submissions: 0, paidCalls: 0 };
const check = (condition, message) => { assert.ok(condition, message); report.assertions.push(message); };
const token = randomBytes(32).toString('hex');
const instance = randomUUID();
let backendUrl;

async function connect(pair, modern = false) {
  const client = new Client({ name: 'mrgoose-offline-verifier', version: '1' }, modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {});
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'mcp', 'server.cjs')],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', MRGOOSE_MCP_DIRECTORY: path.join(directory, 'control'), MRGOOSE_MCP_CREDENTIAL: pair.credentialPath }, stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', b => { stderr += b.toString(); });
  await client.connect(transport); clients.push(client);
  return { client, stderr: () => stderr };
}
async function call(client, name, args = {}, error) {
  const result = await client.callTool({ name, arguments: args });
  const value = JSON.parse(result.content[0].text);
  if (error) { assert.equal(result.isError, true); assert.equal(value.code, error, JSON.stringify(value)); report.assertions.push('Rejected ' + error); }
  else assert.notEqual(result.isError, true, JSON.stringify(value));
  return value;
}

app.whenReady().then(async () => {
  fixture = http.createServer((req, res) => {
    if (req.method !== 'GET') { report.submissions++; res.writeHead(405); res.end(); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><title>MrGoose local MCP fixture</title><h1>Local test — no Arena</h1>
      <form><label for="payload">Payload</label><textarea id="payload" oninput="document.getElementById('result').textContent='Observed: '+this.value"></textarea><button type="submit">Launch (manual only)</button></form>
      <input type="password" id="password" value="do-not-return"><pre id="result">No input</pre>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  // Choose a free local port. Health verifies our instance, never an arbitrary listener.
  const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  backendUrl = `http://127.0.0.1:${reservation.address().port}`; await new Promise(resolve => reservation.close(resolve));
  const backendLog = fs.openSync(path.join(directory, 'backend.log'), 'a');
  backend = spawn(path.join(root, 'work', 'mcp-increment', 'backend', 'MrGoose.Backend.exe'), ['--urls', backendUrl], {
    cwd: root, windowsHide: true, stdio: ['ignore', backendLog, backendLog],
    env: { ...process.env, MRGOOSE_CONTROL_TOKEN: token, MRGOOSE_INSTANCE_ID: instance, MRGOOSE_RENDERER_ORIGIN: origin, MRGOOSE_DB_PATH: path.join(directory, 'test.db') }
  });
  backend.on('error', e => { throw e; });
  let healthy = false;
  for (let n = 0; n < 150; n++) {
    try { const response = await fetch(backendUrl + '/health', { headers: { Authorization: 'Bearer ' + token } }); healthy = response.ok && (await response.json()).instanceId === instance; } catch {}
    if (healthy) break; await new Promise(resolve => setTimeout(resolve, 200));
  }
  check(healthy, 'Isolated backend authenticated and seeded');
  check((await fetch(backendUrl + '/api/challenges')).status === 401, 'Backend rejects unauthenticated library access');
  check((await fetch(backendUrl + '/api/challenges', { headers: { Authorization: 'Bearer ' + token, Origin: 'https://untrusted.invalid' } })).status === 403, 'Backend rejects unrelated Origin even with token');
  const data = async (operation, args) => {
    const response = await fetch(backendUrl + '/api/control/' + operation, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.code), { code: value.code }); return value;
  };
  const browser = new ArenaBrowserService({ WebContentsView, getWindow: () => window, changed: tabs => popup?.update(tabs), allowedOrigins: [origin] });
  popup = createArenaWindow({ BrowserWindow, ipcMain, browser, isQuitting: () => false, openCockpit: () => {} });
  window = await popup.create();
  const present = id => popup.show(id);
  control = new LocalControl({ directory: path.join(directory, 'control'), browser, data, present, hide: () => window.hide(), runtimePath: process.execPath, adapterPath: path.join(root, 'mcp', 'server.cjs'), onError: error => console.error(error) });
  await control.start();
  const defaultCredentialPath = path.join(directory, 'control', 'local.credential.json');
  const pair = { credentialPath: defaultCredentialPath, clientId: JSON.parse(fs.readFileSync(defaultCredentialPath, 'utf8')).clientId };
  const secondPair = control.pair('Other client');
  const { client } = await connect(pair);
  const tools = await client.listTools();
  check(tools.tools.length === 16 && !tools.tools.some(t => /submit|launch|execute|click|eval/.test(t.name)), '16 bounded MCP tools; automatic local access, no submit/click/code-execution tool');
  const status = await call(client, 'mrgoose_status'); check(status.collector === 'unavailable' && status.manualSubmitOnly, 'Capabilities explicitly report absent collector');
  const scenarios = await call(client, 'library_search', { collection: 'scenarios' });
  const hit = scenarios.hits[0]; check(!!hit?.hash, 'Scenario search returns provenance and hash');
  const scenarioRead = await call(client, 'library_read', { collection: 'scenarios', id: hit.id, expectedHash: hit.hash });
  const scenario = JSON.parse(scenarioRead.content);
  const techniques = await call(client, 'library_search', { collection: 'techniques' });
  const technique = await call(client, 'library_read', { collection: 'techniques', id: techniques.hits[0].id });
  check(!!JSON.parse(technique.content).whenItWorks && technique.source.startsWith('app:'), 'Read actual technique applicability from app library');
  await call(client, 'library_read', { collection: 'scenarios', id: hit.id, expectedHash: '0'.repeat(64) }, 'CONTENT_CHANGED');
  const models = await call(client, 'library_search', { collection: 'models', challengeSlug: hit.challenge });
  const model = JSON.parse((await call(client, 'library_read', { collection: 'models', id: models.hits[0].id })).content);
  check(!window.isVisible(), 'MCP data reads leave Arena popup hidden');
  const opened = await call(client, 'arena_open_tab', { url: origin + '/arena/fixture' });
  check(window.isVisible(), 'MCP arena_open_tab explicitly shows the separate Arena popup');
  const discovered = await call(client, 'arena_inspect', { tabId: opened.id, navigation: opened.navigation });
  check(discovered.fields.some(f => f.selector === '#payload' && f.editable), 'Bootstrap discovers editable field without a saved profile');
  await call(client, 'arena_bind_profile', { tabId: opened.id, navigation: opened.navigation, challengeSlug: hit.challenge, fields: { secret: '#password' } }, 'FIELD_NOT_INSPECTED');
  const profile = await call(client, 'arena_bind_profile', { tabId: opened.id, navigation: opened.navigation, challengeSlug: hit.challenge, fields: { payload: '#payload' }, resultSelector: '#result' });
  const context = { challengeSlug: hit.challenge, scenarioId: scenario.id, modelId: model.id, profileId: profile.id };
  await call(client, 'attempt_prepare', { ...context, requestKey: 'unknown-profile', profileId: 'absent', fields: { payload: 'x' } }, 'PROFILE_UNVERIFIED');
  await call(client, 'attempt_prepare', { ...context, requestKey: 'unapproved-field', fields: { password: 'x' } }, 'FIELD_NOT_APPROVED');
  const exactA = '  first 🪿\n"quoted" `literal` ${noExecution} <script>data only</script>  ';
  const exactB = 'second\nindependent payload';
  const prepareA = { ...context, tabId: opened.id, navigation: opened.navigation, requestKey: 'A', fields: { payload: exactA } };
  const [a, b] = await Promise.all([
    call(client, 'attempt_prepare', prepareA),
    call(client, 'attempt_prepare', { ...context, requestKey: 'B', fields: { payload: exactB } })
  ]);
  check(a.state === 'needs_review' && b.state === 'needs_review' && a.tabId !== b.tabId, 'Two real Electron tabs prepared independently through MCP: ' + JSON.stringify({ a: a.error || a.state, b: b.error || b.state }));
  check(a.contextVerification === 'operator_required' && a.providerIdentity === null, 'No invented model-selection or provider identity claim');
  browser.select(b.tabId);
  const actualA = await browser.page(a.tabId, 'read', { selector: '#payload' });
  browser.select(a.tabId);
  const actualB = await browser.page(b.tabId, 'read', { selector: '#payload' });
  check(actualA.text === exactA && actualB.text === exactB, 'Exact Unicode/whitespace payloads stay in correct tabs despite active-tab switches');
  const replay = await call(client, 'attempt_prepare', prepareA);
  check(replay.id === a.id && browser.tabs.size === 2, 'Idempotent prepare replay does not create another tab');
  await call(client, 'attempt_prepare', { ...context, requestKey: 'A', fields: { payload: 'changed' } }, 'IDEMPOTENCY_CONFLICT');
  const inspected = await call(client, 'attempt_inspect', { attemptId: a.id, navigation: a.runtime.navigation });
  check(inspected.fields.some(x => x.id === 'payload') && !inspected.fields.some(x => x.id === 'password'), 'Field inspection excludes password and returns metadata only');
  const other = (await connect(secondPair, true)).client;
  await call(other, 'attempt_get', { attemptId: a.id }, 'ATTEMPT_NOT_FOUND');
  check((await call(other, 'arena_tabs')).length === 0, 'Other authorized client cannot list owner tabs');
  await call(client, 'window_hide'); check(!window.isVisible(), 'Window hides without destroying browser tabs');
  const [observationA, observationB] = await Promise.all([
    call(client, 'attempt_observe', { attemptId: a.id, navigation: a.runtime.navigation, requestKey: 'read-A' }),
    call(client, 'attempt_observe', { attemptId: b.id, navigation: b.runtime.navigation, requestKey: 'read-B' })
  ]);
  check(observationA.text === 'Observed: ' + exactA && observationB.text === 'Observed: ' + exactB, 'Hidden-window observations saved separately through MCP');
  check(observationA.completion === 'unknown' && observationB.providerIdentity === null, 'Observations never claim finality or a run ID');
  const readReplay = await call(client, 'attempt_observe', { attemptId: a.id, navigation: a.runtime.navigation, requestKey: 'read-A' });
  check(readReplay.id === observationA.id, 'Observation retry returns the saved receipt without duplicate capture');
  await call(client, 'attempt_observe', { attemptId: a.id, navigation: a.runtime.navigation + 1, requestKey: 'read-A' }, 'IDEMPOTENCY_CONFLICT');
  const metadata = await call(client, 'attempt_list');
  check(metadata.length === 2 && !Object.hasOwn(metadata[0], 'fields'), 'Attempt listing returns bounded metadata without payload dumps');
  await client.close();
  const reconnect = (await connect(pair, true)).client;
  check((await call(reconnect, 'attempt_observations', { attemptId: a.id }))[0].id === observationA.id, 'MCP reconnect reads persistent observation A');
  check((await call(reconnect, 'attempt_observations', { attemptId: b.id }))[0].id === observationB.id, 'MCP reconnect reads persistent observation B');
  await call(reconnect, 'attempt_observe', { attemptId: a.id, navigation: a.runtime.navigation + 1, requestKey: 'stale' }, 'NAVIGATION_CHANGED');
  const denied = await fetch(control.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check(denied.status === 401, 'Broker rejects missing client credential');
  const credential = JSON.parse(fs.readFileSync(pair.credentialPath));
  const unicodeTitle = 'Chunk boundary 🪿 check';
  const seededPrompt = await fetch(backendUrl + '/api/prompts', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: unicodeTitle, body: 'Local encoding fixture' }) });
  check(seededPrompt.ok, 'Isolated Unicode prompt fixture created without model calls');
  const wire = Buffer.from(JSON.stringify({ operation: 'library_search', args: { collection: 'prompts', query: unicodeTitle } }));
  const split = wire.indexOf(Buffer.from('🪿')) + 1;
  const splitResult = await new Promise((resolve, reject) => {
    const request = http.request(control.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': wire.length, Authorization: 'Bearer ' + credential.token } }, response => {
      response.setEncoding('utf8'); let body = '';
      response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on('error', reject); request.write(wire.subarray(0, split)); setTimeout(() => request.end(wire.subarray(split)), 40);
  });
  check(splitResult.ok && splitResult.value.hits.some(hit => hit.title === unicodeTitle), 'Broker preserves a UTF-8 code point split across network chunks');
  const hostileOrigin = await fetch(control.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Authorization: 'Bearer ' + credential.token }, body: '{}' });
  check(hostileOrigin.status === 403, 'Broker rejects browser-origin requests even with a credential');
  const deniedOperation = await fetch(control.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + credential.token }, body: JSON.stringify({ operation: 'submit', args: {} }) });
  check((await deniedOperation.json()).error.code === 'UNKNOWN_OPERATION', 'Broker rejects arbitrary operations');
  await assert.rejects(browser.create('file:///C:/Windows/win.ini'), /URL_DENIED/); report.assertions.push('Denied file URL');
  check(report.submissions === 0, 'No fixture launch/submit occurred');
  await call(reconnect, 'attempt_present', { attemptId: b.id }); check(window.isVisible() && browser.activeTabId === b.tabId, 'Explicit attempt presentation restores correct tab');
  control.saveProfile({ id: 'missing-field', challengeSlug: hit.challenge, url: origin + '/arena/fixture', fields: { payload: '#missing' }, resultSelector: '#result' });
  const failed = await call(reconnect, 'attempt_prepare', { ...context, profileId: 'missing-field', requestKey: 'partial', fields: { payload: 'must fail explicitly' } });
  check(failed.state === 'preparation_failed' && failed.error.code === 'FIELD_NOT_FOUND', 'Failed selector persists an explicit incomplete attempt without claiming ready');
  await browser.entry(a.tabId).view.webContents.loadURL(origin + '/arena/another-chat');
  const changed = await call(reconnect, 'attempt_get', { attemptId: a.id });
  await call(reconnect, 'attempt_observe', { attemptId: a.id, navigation: changed.runtime.navigation, requestKey: 'other-chat' }, 'IDENTITY_UNVERIFIED');
  // Recreate broker/browser ownership to model desktop restart; durable backend DB is unchanged.
  await control.stop();
  const restoredBrowser = new ArenaBrowserService({ WebContentsView, getWindow: () => window, allowedOrigins: [origin] });
  control = new LocalControl({ directory: path.join(directory, 'control'), browser: restoredBrowser, data, present, hide: () => window.hide(), runtimePath: process.execPath, adapterPath: path.join(root, 'mcp', 'server.cjs') });
  await control.start();
  const detached = await call(reconnect, 'attempt_get', { attemptId: a.id });
  check(!detached.runtime.attached && detached.runtime.code === 'TAB_DETACHED', 'New desktop generation does not silently reuse old tabs');
  check((await call(reconnect, 'attempt_observations', { attemptId: a.id }))[0].text === observationA.text, 'Saved observations remain readable after broker restart');
  await call(reconnect, 'attempt_present', { attemptId: a.id }, 'TAB_DETACHED');
  control.revoke(pair.clientId);
  await call(reconnect, 'mrgoose_status', {}, 'UNAUTHORIZED');
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log('PASS: ' + report.assertions.length + ' MCP/Electron/backend assertions. Report: ' + path.join(directory, 'report.json'));
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const client of clients) { try { await client.close(); } catch {} }
  await control?.stop(); window?.destroy(); backend?.kill();
  fixture?.close(); app.exit(process.exitCode || 0);
});
