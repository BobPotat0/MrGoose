const { randomUUID } = require('node:crypto');

class ControlError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new ControlError(code, message); };

// These functions are compiled locally, never accepted from a client or page.
function pageOperation(operation, args) {
  const error = code => ({ ok: false, code, note: code });
  const safe = el => el && !el.closest('input[type=password],input[type=hidden]')
    && !/password|credential|auth.?token|api.?key|secret|csrf/i.test(`${el.id} ${el.name} ${el.getAttribute('autocomplete') || ''}`);
  const selectorFor = el => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    while (el && el.tagName !== 'HTML') {
      const peers = [...el.parentElement.children].filter(x => x.tagName === el.tagName);
      parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + (peers.indexOf(el) + 1) + ')'); el = el.parentElement;
    }
    return parts.join(' > ');
  };
  if (operation === 'inspect') {
    return { ok: true, fields: [...document.querySelectorAll('textarea,input,[contenteditable=true],select')].filter(el => safe(el) && el.getClientRects().length)
      .slice(0, 100).map(el => ({ tag: el.tagName.toLowerCase(), type: el.type || '', id: el.id, name: el.name || '',
        label: (el.getAttribute('aria-label') || el.labels?.[0]?.innerText || '').slice(0, 120),
        editable: !el.disabled && !el.readOnly && (el.tagName === 'TEXTAREA' || el.isContentEditable || el.tagName === 'INPUT' && ['text', 'search', 'url', 'email', 'tel'].includes(el.type)),
        selector: selectorFor(el) })),
      context: { title: document.title,
        headings: [...document.querySelectorAll('h1,h2,h3')].filter(el => el.getClientRects().length).slice(0, 15).map(el => (el.innerText || '').slice(0, 200)),
        controls: [...document.querySelectorAll('button,[role=combobox],select')].filter(el => el.getClientRects().length && safe(el)).slice(0, 60).map(el => ({ role: el.getAttribute('role') || el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || el.innerText || '').slice(0, 160), selected: el.tagName === 'SELECT' ? [...el.selectedOptions].map(x => x.label) : undefined })) },
      regions: [...document.querySelectorAll('main,article,pre,[role=log],[aria-live]')].filter(el => safe(el) && el.getClientRects().length && !el.querySelector('input[type=password]')).slice(0, 15)
        .map(el => ({ selector: selectorFor(el), role: el.getAttribute('role') || el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || '').slice(0, 120) })) };
  }
  let matches;
  try { matches = document.querySelectorAll(args.selector || 'body'); } catch { return error('INVALID_SELECTOR'); }
  if (matches.length !== 1) return error(matches.length ? 'AMBIGUOUS_FIELD' : 'FIELD_NOT_FOUND');
  const el = matches[0];
  if (!safe(el) || el.querySelector('input[type=password]')) return error('SENSITIVE_FIELD');
  if (operation === 'fill') {
    if (!el.getClientRects().length || el.disabled || el.readOnly) return error('FIELD_NOT_EDITABLE');
    if (el.isContentEditable) {
      el.textContent = args.value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: args.value }));
    } else {
      if (el.tagName !== 'TEXTAREA' && !(el.tagName === 'INPUT' && ['text', 'search', 'url', 'email', 'tel'].includes(el.type))) return error('FIELD_TYPE_DENIED');
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, args.value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const value = el.isContentEditable ? el.textContent : el.value;
    return value === args.value ? { ok: true, text: value } : error('READBACK_MISMATCH');
  }
  if (operation === 'highlight') {
    el.scrollIntoView({ block: 'center' });
    const previous = el.style.outline; el.style.outline = '3px solid #b6f23d';
    setTimeout(() => { el.style.outline = previous; }, 2500);
    return { ok: true };
  }
  const text = String(el.value ?? el.innerText ?? '');
  const limit = args.limit || 16000;
  return { ok: true, text: text.slice(0, limit), totalChars: text.length, truncated: text.length > limit };
}

function pickOperation() {
  return new Promise(resolve => {
    const listener = event => {
      event.preventDefault(); event.stopPropagation();
      document.removeEventListener('click', listener, true);
      const el = event.target;
      if (el.matches('input[type=password],input[type=hidden]')) return resolve({ ok: false, code: 'SENSITIVE_FIELD' });
      const parts = []; let cursor = el;
      while (cursor && cursor.tagName !== 'HTML') {
        if (cursor.id) { parts.unshift('#' + CSS.escape(cursor.id)); break; }
        let part = cursor.tagName.toLowerCase();
        const siblings = [...cursor.parentElement.children].filter(x => x.tagName === cursor.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cursor) + 1) + ')';
        parts.unshift(part); cursor = cursor.parentElement;
      }
      resolve({ ok: true, selector: parts.join(' > ') });
    };
    document.addEventListener('click', listener, true);
    setTimeout(() => { document.removeEventListener('click', listener, true); resolve({ ok: false, code: 'PICK_TIMEOUT' }); }, 30000);
  });
}

class ArenaBrowserService {
  constructor({ WebContentsView, getWindow, changed = () => {}, allowedOrigins = ['https://app.grayswan.ai'] }) {
    this.WebContentsView = WebContentsView; this.getWindow = getWindow; this.changed = changed;
    this.origins = new Set(allowedOrigins); this.tabs = new Map(); this.activeTabId = null;
    this.generation = randomUUID(); this.visible = false; this.bounds = { x: 0, y: 0, width: 0, height: 0 };
  }
  validateUrl(value, page = false) {
    let url; try { url = new URL(value); } catch { fail('URL_DENIED'); }
    if (!this.origins.has(url.origin) || url.username || url.password || (page && /(?:login|signin|sign-in|oauth|auth|settings|account)/i.test(url.pathname))) fail('URL_DENIED');
    return url;
  }
  entry(id) { const entry = this.tabs.get(id); if (!entry || entry.view.webContents.isDestroyed()) fail('TAB_NOT_FOUND'); return entry; }
  list() { return [...this.tabs.values()].map(t => ({ id: t.id, url: t.view.webContents.getURL(), title: t.view.webContents.getTitle(), label: t.label || '', active: t.id === this.activeTabId, navigation: t.navigation, loading: t.view.webContents.isLoading(), attemptId: t.attemptId || null })); }
  notify() { this.changed(this.list()); }
  visibility() { for (const t of this.tabs.values()) { const show = this.visible && t.id === this.activeTabId; t.view.setVisible(show); if (show) t.view.setBounds(this.bounds); } }
  setVisible(value) { this.visible = !!value; this.visibility(); }
  setBounds(rect) { for (const k of ['x', 'y', 'width', 'height']) if (!Number.isFinite(rect[k]) || Math.abs(rect[k]) > 100000) fail('INVALID_BOUNDS'); this.bounds = Object.fromEntries(Object.entries(rect).map(([k,v]) => [k, Math.max(0, Math.round(v))])); this.visibility(); }
  async create(url = 'https://app.grayswan.ai/', ownership = {}) {
    this.validateUrl(url);
    const window = this.getWindow(); if (!window || window.isDestroyed()) fail('APP_UNAVAILABLE');
    const id = randomUUID();
    const view = new this.WebContentsView({ webPreferences: { partition: 'persist:arena', contextIsolation: true, sandbox: true, nodeIntegration: false } });
    const tab = { id, view, navigation: 0, queue: Promise.resolve(), ...ownership };
    this.tabs.set(id, tab); window.contentView.addChildView(view); view.setBounds(this.bounds);
    this.activeTabId = id; this.visibility();
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-redirect']) view.webContents.on(event, (e, target) => { try { this.validateUrl(target); } catch { e.preventDefault(); } });
    view.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) { tab.navigation++; this.notify(); } });
    for (const event of ['did-finish-load', 'page-title-updated', 'render-process-gone']) view.webContents.on(event, () => this.notify());
    this.notify();
    const deadline = Date.now() + 20000;
    let timer;
    try {
      await Promise.race([view.webContents.loadURL(url), new Promise((_, reject) => { timer = setTimeout(() => reject(new ControlError('LOAD_TIMEOUT')), 20000); timer.unref(); })]);
      // loadURL can resolve before a renderer-triggered follow-up load settles.
      let stableSince = Date.now(), revision = tab.navigation;
      while (true) {
        this.entry(id);
        if (view.webContents.isLoading() || tab.navigation !== revision) { stableSince = Date.now(); revision = tab.navigation; }
        else if (Date.now() - stableSince >= 300) break;
        if (Date.now() >= deadline) fail('LOAD_TIMEOUT');
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    }
    catch (error) { error.tabId = id; throw error; }
    finally { clearTimeout(timer); }
    return id;
  }
  select(id) { this.entry(id); this.activeTabId = id; this.visibility(); this.notify(); return this.list(); }
  close(id) { const t = this.entry(id); this.getWindow()?.contentView.removeChildView(t.view); t.view.webContents.close(); this.tabs.delete(id); if (id === this.activeTabId) this.activeTabId = this.tabs.keys().next().value || null; this.visibility(); this.notify(); return this.list(); }
  async loadUrl(id, url) { this.validateUrl(url); const t = this.entry(id); if (t.attemptId) fail('ATTEMPT_TAB_LOCKED'); await t.view.webContents.loadURL(url); return true; }
  async page(id, operation, args = {}, navigation) {
    const t = this.entry(id);
    const execute = async () => {
      this.entry(id); this.validateUrl(t.view.webContents.getURL(), true);
      if (navigation !== undefined && t.navigation !== navigation) fail('NAVIGATION_CHANGED');
      if (t.view.webContents.isLoading()) fail('TAB_LOADING');
      const before = t.navigation;
      if (!['fill', 'read', 'snapshot', 'highlight', 'inspect', 'pick'].includes(operation)) fail('UNKNOWN_OPERATION');
      const source = operation === 'pick' ? `(${pickOperation.toString()})()` : `(${pageOperation.toString()})(${JSON.stringify(operation)},${JSON.stringify(args)})`;
      const value = await t.view.webContents.executeJavaScript(source);
      if (before !== t.navigation) fail('NAVIGATION_CHANGED');
      return { ...value, tabId: id, navigation: t.navigation, generation: this.generation };
    };
    const pending = t.queue.then(execute); t.queue = pending.catch(() => {}); return pending;
  }
}
module.exports = { ArenaBrowserService, ControlError, fail };
