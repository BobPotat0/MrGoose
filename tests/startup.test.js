const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createStartupController } = require('../electron/startup-controller');

function harness() {
  const events = [];
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.visible = false;
      this.webContents = { send: (_channel, value) => events.push(value) };
      windows.push(this);
    }
    async loadFile() {}
    show() { this.visible = true; events.push('splash-show'); }
    close() { events.push('splash-close'); this.destroyed = true; this.emit('closed'); }
    isDestroyed() { return this.destroyed; }
  }
  const ipcMain = new EventEmitter();
  const app = { quit() { events.push('quit'); } };
  const controller = createStartupController({
    app, BrowserWindow: Window, ipcMain, directory: path.join(__dirname, '..', 'electron'),
    wait: async () => {},
  });
  const cockpit = {
    destroyed: false, isDestroyed() { return this.destroyed; },
    destroy() { this.destroyed = true; },
    show() { events.push('cockpit-show'); },
  };
  return { controller, events, windows, ipcMain, cockpit };
}

test('intro appears before boot, and cockpit appears before intro closes', async () => {
  const h = harness();
  await h.controller.open(async phase => {
    assert.ok(h.events.includes('splash-show'));
    phase('service'); phase('workspace'); return h.cockpit;
  });
  assert.ok(h.events.indexOf('cockpit-show') < h.events.indexOf('splash-close'));
  assert.ok(!h.events.includes('quit'));
  assert.equal(h.windows[0].options.webPreferences.sandbox, true);
  assert.equal(h.ipcMain.listenerCount('mrgoose:startup:retry'), 0);
});

test('failed startup stays open and retries only from the intro renderer', async () => {
  const h = harness();
  let attempts = 0;
  await h.controller.open(async () => {
    if (++attempts === 1) throw new Error('Expected unavailable renderer');
    return h.cockpit;
  });
  assert.ok(h.events.includes('error'));
  assert.equal(h.windows[0].destroyed, false);
  h.ipcMain.emit('mrgoose:startup:retry', { sender: {} });
  assert.equal(attempts, 1);
  h.ipcMain.emit('mrgoose:startup:retry', { sender: h.windows[0].webContents });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.ok(h.events.includes('cockpit-show'));
});

test('closing during boot prevents a late cockpit from opening', async () => {
  const h = harness();
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const opened = h.controller.open(() => pending);
  await new Promise(resolve => setImmediate(resolve));
  h.windows[0].close();
  finish(h.cockpit);
  await opened;
  assert.equal(h.cockpit.destroyed, true);
  assert.equal(h.events.includes('cockpit-show'), false);
  assert.equal(h.events.filter(value => value === 'quit').length, 1);
});

test('repeated retry clicks cannot start parallel boot attempts', async () => {
  const h = harness();
  let finish;
  let attempts = 0;
  const opened = h.controller.open(() => { attempts++; return new Promise(resolve => { finish = resolve; }); });
  await new Promise(resolve => setImmediate(resolve));
  const event = { sender: h.windows[0].webContents };
  h.ipcMain.emit('mrgoose:startup:retry', event);
  h.ipcMain.emit('mrgoose:startup:retry', event);
  assert.equal(attempts, 1);
  finish(h.cockpit);
  await opened;
});
