const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { resolveRuntimePaths } = require('../electron/runtime-paths');
const { prepareKeyEncryption } = require('../electron/secure-key');
const { createUpdater } = require('../electron/updates');
const { packageLayout } = require('./package-layout.cjs');

test('packaged smoke resolves native Mac bundles and Windows executables', () => {
  const root = path.resolve('fixture');
  const mac = packageLayout(root, 'darwin', 'arm64');
  assert.equal(mac.executable, path.join(root, 'release', 'mac-arm64', 'MrGoose.app', 'Contents', 'MacOS', 'MrGoose'));
  assert.equal(mac.backend, path.join(root, 'release', 'mac-arm64', 'MrGoose.app', 'Contents', 'Resources', 'backend', 'MrGoose.Backend'));
  assert.equal(packageLayout(root, 'darwin', 'x64').resources, path.join(root, 'release', 'mac', 'MrGoose.app', 'Contents', 'Resources'));
  assert.equal(packageLayout(root, 'darwin', 'arm64', path.join(root, 'Test.app')).executable, path.join(root, 'Test.app', 'Contents', 'MacOS', 'MrGoose'));
  assert.equal(packageLayout(root, 'win32', 'x64').backend, path.join(root, 'release', 'win-unpacked', 'resources', 'backend', 'MrGoose.Backend.exe'));
});

test('installed paths keep mutable data outside application resources on Windows and Mac', () => {
  for (const platform of ['win32', 'darwin']) {
    const app = path.resolve('installed', 'app.asar'), resources = path.resolve('installed', 'resources'), user = path.resolve('user', 'MrGoose');
    const result = resolveRuntimePaths({ isPackaged: true, projectRoot: app, resourcesPath: resources, userDataPath: user, platform, env: {} });
    assert.equal(result.backend, path.join(resources, 'backend', platform === 'win32' ? 'MrGoose.Backend.exe' : 'MrGoose.Backend'));
    for (const key of ['profile', 'mcp', 'database', 'logs', 'crashes']) assert.ok(result[key].startsWith(user + path.sep));
    assert.equal(result.client, path.join(resources, 'client'));
  }
  const result = resolveRuntimePaths({ isPackaged: false, projectRoot: path.resolve('checkout'), env: {} });
  assert.equal(result.database, path.resolve('checkout/backend/bin/Debug/net10.0/mrgoose.db'));
  assert.throws(() => resolveRuntimePaths({ isPackaged: true, env: { MRGOOSE_DATA_DIR: 'relative' } }), /absolute/);
});

test('desktop encryption key survives restart and is persisted only through the OS wrapper', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mrgoose-key-'));
  let wraps = 0;
  const wrapped = new Map();
  const store = { isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async raw => { wraps++; wrapped.set('os-wrapped-key', raw); return Buffer.from('os-wrapped-key'); },
    decryptStringAsync: async buffer => ({ result: wrapped.get(buffer.toString()) }) };
  try {
    const first = await prepareKeyEncryption(directory, store);
    assert.equal(Buffer.from(first, 'base64').length, 32);
    assert.equal(await prepareKeyEncryption(directory, store), first);
    assert.equal(wraps, 1);
    assert.equal(fs.readFileSync(path.join(directory, 'key-encryption.bin'), 'utf8'), 'os-wrapped-key');
    await assert.rejects(prepareKeyEncryption(directory, { isAsyncEncryptionAvailable: async () => false }), /unavailable/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('updates never auto-install and require a separate download after checking', async () => {
  const previous = process.resourcesPath;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mrgoose-update-'));
  process.resourcesPath = directory;
  const engine = new EventEmitter();
  let downloads = 0;
  engine.checkForUpdates = async () => engine.emit('update-available', { version: '0.2.0' });
  engine.downloadUpdate = async () => { downloads++; engine.emit('update-downloaded', { version: '0.2.0' }); };
  try {
    const unavailable = createUpdater({ app: { isPackaged: true }, engine });
    assert.equal((await unavailable.check()).state, 'unavailable');
    fs.writeFileSync(path.join(directory, 'app-update.yml'), 'provider: github');
    const updater = createUpdater({ app: { isPackaged: true }, engine });
    assert.equal(engine.autoDownload, false); assert.equal(engine.autoInstallOnAppQuit, false);
    assert.equal((await updater.check()).state, 'available'); assert.equal(downloads, 0);
    assert.equal((await updater.download()).state, 'ready'); assert.equal(downloads, 1);
    engine.emit('error', new Error('secret provider URL'));
    assert.ok(!updater.status().message.includes('secret'));
  } finally { process.resourcesPath = previous; fs.rmSync(directory, { recursive: true, force: true }); }
});
