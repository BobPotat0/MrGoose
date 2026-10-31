const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Electron profile stays under the checkout and is configured before readiness', () => {
  const root = path.resolve(__dirname, '..');
  const configured = new Map();
  const directories = new Set();
  let readyRequested = false;
  const electronApp = {
    setPath(name, destination) {
      assert.equal(readyRequested, false, 'profile paths must be set before ready');
      assert.ok(directories.has(destination), 'Electron requires existing directories');
      configured.set(name, destination);
    },
    setAppLogsPath(destination) {
      assert.equal(readyRequested, false);
      assert.ok(directories.has(destination));
      configured.set('logs', destination);
    },
    whenReady() {
      readyRequested = true;
      return new Promise(() => {});
    },
    on() {},
  };
  const source = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  vm.runInNewContext(source, {
    __dirname: path.join(root, 'electron'),
    require(name) {
      if (name === 'electron') return { app: electronApp };
      if (name === 'node:path') return path;
      if (name === 'node:crypto') return require(name);
      if (name === './startup-controller') return require('../electron/startup-controller');
      if (name === './runtime-paths') return require('../electron/runtime-paths');
      if (name === 'node:fs') return { mkdirSync(directory) { directories.add(directory); } };
      if (name === 'node:child_process') return { spawn() { throw new Error('No processes should be launched in this check'); } };
      throw new Error('Unexpected dependency: ' + name);
    },
    process: { env: {}, platform: process.platform, on() {}, cwd() { throw new Error('Do not resolve storage from the invoking directory'); } },
    console,
    URL,
  }, { filename: 'electron/main.js' });
  assert.equal(readyRequested, true);
  assert.equal(configured.get('userData'), path.join(root, 'data', 'desktop'));
  assert.equal(configured.get('sessionData'), path.join(root, 'data', 'desktop'));
  assert.equal(configured.get('crashDumps'), path.join(root, 'data', 'crashes'));
  assert.equal(configured.get('logs'), path.join(root, 'data', 'logs'));
});
