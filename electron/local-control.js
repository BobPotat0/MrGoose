const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { operations } = require('../mcp/catalog.cjs');
const { fail, ControlError } = require('./arena-browser-service');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');

function atomicJson(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temporary, file);
}
function protectDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') {
    const sid = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { encoding: 'utf8', windowsHide: true }).trim();
    if (!/^S-1-\d+(?:-\d+)+$/.test(sid)) fail('CREDENTIAL_STORAGE_UNAVAILABLE');
    execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { windowsHide: true, stdio: 'pipe' });
  } else fs.chmodSync(directory, 0o700);
}

class LocalControl {
  constructor({ directory, browser, data, present, hide, runtimePath, adapterPath, onError = () => {} }) {
    this.directory = directory; this.browser = browser; this.data = data; this.present = present; this.hide = hide;
    this.runtimePath = runtimePath; this.adapterPath = adapterPath; this.queues = new Map();
    this.onError = onError;
    protectDirectory(directory);
    this.registryPath = path.join(directory, 'clients.json'); this.profilesPath = path.join(directory, 'profiles.json');
    if (!fs.existsSync(this.registryPath)) atomicJson(this.registryPath, []);
    if (!fs.existsSync(this.profilesPath)) atomicJson(this.profilesPath, []);
    // Local desktop clients inherit the current OS user's access. No pairing UI is required.
    const localPath = path.join(directory, 'local.credential.json');
    let local;
    try { local = JSON.parse(fs.readFileSync(localPath, 'utf8')); } catch {}
    if (!local || !this.clients().some(c => c.id === local.clientId && c.tokenHash === hash(local.token))) {
      const issued = this.pair('Local user');
      atomicJson(localPath, JSON.parse(fs.readFileSync(issued.credentialPath, 'utf8')));
    }
  }
  clients() { return JSON.parse(fs.readFileSync(this.registryPath, 'utf8')); }
  profiles() { return JSON.parse(fs.readFileSync(this.profilesPath, 'utf8')); }
  management() { return { clients: this.clients().map(({ tokenHash, ...c }) => c), profiles: this.profiles(), endpoint: this.endpoint, enabled: true,
    command: this.runtimePath, args: [this.adapterPath], env: { ELECTRON_RUN_AS_NODE: '1' }, access: 'current OS user; no manual authorization' }; }
  pair(name) {
    if (typeof name !== 'string' || !/^[\w -]{1,60}$/.test(name)) fail('INVALID_CLIENT_NAME');
    const client = { id: randomUUID(), name, tokenHash: '', scopes: ['library.read', 'attempt.read', 'attempt.prepare', 'window.present'], createdAt: new Date().toISOString() };
    const token = randomBytes(32).toString('hex'); client.tokenHash = hash(token);
    atomicJson(this.registryPath, [...this.clients(), client]);
    const credentialPath = path.join(this.directory, client.id + '.credential.json');
    atomicJson(credentialPath, { clientId: client.id, token });
    // Token stays in the user-only file; the host config contains its path, never the token.
    return { clientId: client.id, credentialPath, command: this.runtimePath, args: [this.adapterPath], env: { ELECTRON_RUN_AS_NODE: '1', MRGOOSE_MCP_DIRECTORY: this.directory, MRGOOSE_MCP_CREDENTIAL: credentialPath } };
  }
  revoke(id) { atomicJson(this.registryPath, this.clients().filter(c => c.id !== id)); }
  saveProfile(input, approvedBy = 'operator') {
    const { z } = require('zod/v4');
    const value = z.strictObject({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/), challengeSlug: z.string().min(1).max(100),
      url: z.string().max(2000), fields: z.record(z.string().min(1).max(80), z.string().min(1).max(500)), resultSelector: z.string().min(1).max(500).nullable() }).parse(input);
    this.browser.validateUrl(value.url, true);
    if (Object.keys(value.fields).length < 1 || Object.keys(value.fields).length > 20) fail('INVALID_PROFILE');
    atomicJson(this.profilesPath, [...this.profiles().filter(p => p.id !== value.id), { ...value, updatedAt: new Date().toISOString(), approvedBy }]);
  }
  authenticate(header) {
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token.length !== 64) fail('UNAUTHORIZED');
    const digest = Buffer.from(hash(token));
    const client = this.clients().find(c => typeof c.tokenHash === 'string' && c.tokenHash.length === 64 && timingSafeEqual(Buffer.from(c.tokenHash), digest));
    if (!client) fail('UNAUTHORIZED'); return client;
  }
  async start() {
    this.server = http.createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
      try {
        if (req.headers.origin || req.headers.host !== `127.0.0.1:${this.port}` || req.socket.remoteAddress !== '127.0.0.1') fail('ORIGIN_DENIED');
        if (req.method !== 'POST' || req.url !== '/control' || !req.headers['content-type']?.startsWith('application/json')) fail('REQUEST_DENIED');
        const client = this.authenticate(req.headers.authorization);
        // Decode as a stream: a UTF-8 code point may span TCP chunks.
        req.setEncoding('utf8');
        let body = '', bytes = 0;
        for await (const chunk of req) { bytes += Buffer.byteLength(chunk); if (bytes > 1024 * 1024) fail('REQUEST_TOO_LARGE'); body += chunk; }
        const envelope = JSON.parse(body);
        if (!envelope || Object.keys(envelope).some(k => !['operation', 'args'].includes(k))) fail('INVALID_ARGUMENT');
        const value = await this.execute(client, envelope.operation, envelope.args);
        res.end(JSON.stringify({ ok: true, value }));
      } catch (error) {
        if (!error.code) this.onError(error);
        res.statusCode = error.code === 'UNAUTHORIZED' ? 401 : error.code === 'ORIGIN_DENIED' ? 403 : 400;
        res.end(JSON.stringify({ ok: false, error: { code: error.code || 'INVALID_ARGUMENT', message: error.code ? error.message : 'Invalid request' } }));
      }
    });
    this.server.requestTimeout = 30000; this.server.headersTimeout = 5000;
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.port = this.server.address().port; this.endpoint = `http://127.0.0.1:${this.port}/control`;
    atomicJson(path.join(this.directory, 'endpoint.json'), { endpoint: this.endpoint, generation: this.browser.generation, protocol: 1 });
  }
  async stop() { if (this.server) { this.server.closeIdleConnections(); await new Promise(resolve => this.server.close(resolve)); this.server = null; } }
  locked(key, action) { const next = (this.queues.get(key) || Promise.resolve()).then(action); const tail = next.catch(() => {}); this.queues.set(key, tail); tail.finally(() => { if (this.queues.get(key) === tail) this.queues.delete(key); }); return next; }
  async get(owner, attemptId) {
    const attempt = await this.data('attempt_get', { owner, attemptId });
    const tab = this.browser.tabs.get(attempt.tabId);
    return { ...attempt, runtime: tab && attempt.generation === this.browser.generation ? { attached: true, tabId: tab.id, navigation: tab.navigation, generation: this.browser.generation } : { attached: false, code: 'TAB_DETACHED' } };
  }
  attached(attempt) {
    if (!attempt.runtime.attached) fail('TAB_DETACHED');
    const tab = this.browser.entry(attempt.tabId);
    if (tab.attemptId !== attempt.id || tab.owner !== attempt.owner) fail('SCOPE_DENIED');
    return tab;
  }
  async execute(client, operation, input) {
    const entry = Object.hasOwn(operations, operation) ? operations[operation] : null;
    if (!entry) fail('UNKNOWN_OPERATION');
    if (!client.scopes.includes(entry.scope)) fail('SCOPE_DENIED');
    const parsed = entry.schema.safeParse(input); if (!parsed.success) fail('INVALID_ARGUMENT', parsed.error.message);
    const args = parsed.data, owner = client.id;
    if (operation === 'mrgoose_status') return { version: 1, generation: this.browser.generation, transport: 'stdio', collector: 'unavailable', runIdentity: 'unverified', manualSubmitOnly: true, contextVerification: 'operator_required', capacity50Verified: false, library: 'app only; separate research corpus not integrated' };
    if (operation.startsWith('library_')) return this.data(operation, args);
    if (operation === 'arena_tabs') return this.browser.list().filter(t => this.browser.tabs.get(t.id).owner === owner);
    if (operation === 'arena_profiles') return this.profiles();
    if (operation === 'arena_open_tab') {
      const tabId = await this.browser.create(args.url, { owner });
      await this.present(tabId);
      return this.browser.list().find(t => t.id === tabId);
    }
    if (operation === 'arena_inspect' || operation === 'arena_bind_profile') {
      const tab = this.browser.entry(args.tabId);
      if (tab.owner !== owner) fail('SCOPE_DENIED');
      const inspected = await this.browser.page(tab.id, 'inspect', {}, args.navigation);
      if (!inspected.ok) fail(inspected.code || 'INSPECT_FAILED');
      if (operation === 'arena_inspect') return inspected;
      if (tab.attemptId) fail('ATTEMPT_TAB_LOCKED');
      for (const selector of Object.values(args.fields)) if (!inspected.fields.some(f => f.selector === selector && f.editable)) fail('FIELD_NOT_INSPECTED');
      if (args.resultSelector && !inspected.regions.some(r => r.selector === args.resultSelector)) fail('REGION_NOT_INSPECTED');
      const profile = { id: randomUUID(), challengeSlug: args.challengeSlug, url: tab.view.webContents.getURL(), fields: args.fields, resultSelector: args.resultSelector || null };
      this.saveProfile(profile, 'inspected-local-client');
      return { ...profile, source: 'fields verified against owned tab at explicit navigation revision' };
    }
    if (operation === 'attempt_list') return this.data('attempts', { owner, ...args });
    if (operation === 'window_hide') { this.hide(); return { hidden: true, collector: 'unavailable' }; }
    if (operation === 'attempt_prepare') return this.locked(owner, async () => {
      const requestHash = hash(args);
      const existing = await this.data('attempt_find', { owner, requestKey: args.requestKey });
      if (existing.found) { if (existing.requestHash !== requestHash) fail('IDEMPOTENCY_CONFLICT'); return this.get(owner, existing.id); }
      const profile = this.profiles().find(p => p.id === args.profileId && p.challengeSlug === args.challengeSlug);
      if (!profile) fail('PROFILE_UNVERIFIED');
      for (const field of Object.keys(args.fields)) if (!Object.hasOwn(profile.fields, field)) fail('FIELD_NOT_APPROVED');
      if (Object.keys(profile.fields).some(field => !Object.hasOwn(args.fields, field))) fail('MISSING_PROFILE_FIELD');
      const context = await this.data('context', args);
      const id = randomUUID();
      const record = { id, owner, context, fields: args.fields, payloadHash: hash(args.fields), profile: structuredClone(profile), generation: this.browser.generation,
        tabId: null, state: 'preparing', revision: 1, createdAt: new Date().toISOString(), contextVerification: 'operator_required', providerIdentity: null, completion: 'unknown', receipts: [] };
      await this.data('attempt_create', { owner, id, requestKey: args.requestKey, requestHash, record });
      try {
        if (args.tabId) {
          const tab = this.browser.entry(args.tabId);
          if (tab.owner !== owner || tab.attemptId) fail('TAB_NOT_AVAILABLE');
          if (tab.navigation !== args.navigation || tab.view.webContents.getURL() !== profile.url) fail('NAVIGATION_CHANGED');
          tab.attemptId = id; tab.label = `${context.scenario.code} · ${args.requestKey}`; record.tabId = tab.id;
        } else record.tabId = await this.browser.create(profile.url, { owner, attemptId: id, label: `${context.scenario.code} · ${args.requestKey}` });
        // Persist the identity before any field mutation. A crash leaves an explicit incomplete attempt.
        await this.data('attempt_update', { owner, attemptId: id, record });
        const navigation = this.browser.entry(record.tabId).navigation;
        for (const [key, value] of Object.entries(args.fields)) {
          const result = await this.browser.page(record.tabId, 'fill', { selector: profile.fields[key], value }, navigation);
          if (!result.ok) fail(result.code || 'FILL_FAILED');
          record.receipts.push({ field: key, hash: hash(result.text), navigation, at: new Date().toISOString() });
        }
        // Verify the complete field map after all changes to catch coupled controls.
        for (const [key, value] of Object.entries(args.fields)) {
          const result = await this.browser.page(record.tabId, 'read', { selector: profile.fields[key], limit: 100001 }, navigation);
          if (!result.ok || result.text !== value) fail('READBACK_MISMATCH');
        }
        record.state = 'needs_review'; record.preparedNavigation = navigation;
      } catch (error) { record.state = 'preparation_failed'; record.error = { code: error.code || 'PAGE_ERROR', message: error.code ? error.message : 'Page load or fill failed' }; if (error.tabId) record.tabId = error.tabId; }
      await this.data('attempt_update', { owner, attemptId: id, record });
      if (record.state === 'needs_review') await this.present(record.tabId);
      return this.get(owner, id);
    });
    const attempt = await this.get(owner, args.attemptId);
    if (operation === 'attempt_get') return attempt;
    if (operation === 'attempt_observations') return this.data('observations', { owner, ...args });
    if (operation === 'attempt_observe') {
      const previous = await this.data('observation_find', { owner, attemptId: attempt.id, requestKey: args.requestKey });
      if (previous.found) {
        if (previous.record.requestHash !== hash({ navigation: args.navigation, resultSelector: args.resultSelector || null })) fail('IDEMPOTENCY_CONFLICT');
        return previous.record;
      }
    }
    const tab = this.attached(attempt);
    if (operation === 'attempt_present') { await this.present(tab.id); return { presented: true, attemptId: attempt.id, contextVerification: 'operator_required' }; }
    if (operation === 'attempt_inspect') return this.browser.page(tab.id, 'inspect', {}, args.navigation);
    if (operation === 'attempt_observe') return this.locked(attempt.id, async () => {
      const previous = await this.data('observation_find', { owner, attemptId: attempt.id, requestKey: args.requestKey });
      if (previous.found) { if (previous.record.requestHash !== hash({ navigation: args.navigation, resultSelector: args.resultSelector || null })) fail('IDEMPOTENCY_CONFLICT'); return previous.record; }
      if (args.navigation !== tab.navigation) fail('NAVIGATION_CHANGED');
      if (attempt.state !== 'needs_review') fail('PREPARATION_INCOMPLETE');
      // A new route may be another chat/run. Until the provider adapter can verify identity,
      // refuse to attribute its content to the prepared attempt, even on the same WebContents.
      if (tab.navigation !== attempt.preparedNavigation) fail('IDENTITY_UNVERIFIED');
      const selector = args.resultSelector || attempt.profile.resultSelector;
      if (!selector) fail('RESULT_REGION_UNCONFIGURED');
      if (args.resultSelector) {
        const inspected = await this.browser.page(tab.id, 'inspect', {}, args.navigation);
        if (!inspected.regions?.some(r => r.selector === selector)) fail('REGION_NOT_INSPECTED');
      }
      const read = await this.browser.page(tab.id, 'read', { selector, limit: 16000 }, args.navigation);
      if (!read.ok) fail(read.code || 'READ_FAILED');
      const observation = { id: randomUUID(), attemptId: attempt.id, tabId: tab.id, generation: this.browser.generation, navigation: read.navigation,
        sourceUrl: tab.view.webContents.getURL(), observedAt: new Date().toISOString(), text: read.text, hash: hash(read.text), truncated: read.truncated,
        totalChars: read.totalChars, requestHash: hash({ navigation: args.navigation, resultSelector: args.resultSelector || null }), providerIdentity: null, completion: 'unknown', verdict: null, provenance: 'tab DOM observation; not a verified run result', trust: 'untrusted page data' };
      return this.data('observation_save', { owner, attemptId: attempt.id, requestKey: args.requestKey, id: observation.id, record: observation });
    });
    fail('UNKNOWN_OPERATION');
  }
}
module.exports = { LocalControl, atomicJson, protectDirectory, hash };
