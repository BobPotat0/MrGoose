const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { startCockpitServer } = require('../electron/cockpit-server');

test('optional built cockpit serves only local static assets and SPA routes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mrgoose-cockpit-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Optional cockpit</h1>');
  fs.writeFileSync(path.join(root, 'main.js'), '/* static asset */');
  const server = await startCockpitServer(root, { port: 0 });
  try {
    assert.match(await (await fetch(server.url + '/', { headers: { Accept: 'text/html' } })).text(), /Optional cockpit/);
    assert.match(await (await fetch(server.url + '/settings', { headers: { Accept: 'text/html' } })).text(), /Optional cockpit/);
    assert.equal((await fetch(server.url + '/main.js')).headers.get('content-type'), 'text/javascript');
    assert.equal((await fetch(server.url + '/missing.js')).status, 404);
    assert.equal((await fetch(server.url + '/', { method: 'POST' })).status, 403);
    assert.equal((await fetch(server.url + '/%2e%2e%2foutside.txt')).status, 403);
    const port = Number(new URL(server.url).port);
    const url = server.url;
    await server.close();
    const restarted = await startCockpitServer(root, { port });
    try { assert.equal(restarted.url, url, 'Restart must preserve the renderer origin/history namespace'); }
    finally { await restarted.close(); }
  } finally { await server.close(); fs.unlinkSync(path.join(root, 'index.html')); fs.unlinkSync(path.join(root, 'main.js')); fs.rmdirSync(root); }
});

test('missing optional client build does not prevent Arena-only startup', async () => {
  assert.equal(await startCockpitServer(path.join(__dirname, 'not-a-client-build')), null);
});
