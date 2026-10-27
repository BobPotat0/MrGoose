import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { OrganizerChatStore } from './organizer-chat.store';
import { BackendService } from './backend.service';
import { ArenaService } from './arena.service';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { OrganizerPage } from './pages/organizer';
import { readAgentHistory } from './organizer-chat-history';

const key = 'mg.agent-history.v1:test-backend';
const technique = { id: 17, slug: '', title: '<img src=x onerror=alert(1)>', summary: 'Custom summary', whenItWorks: 'Only with the right surface', example: '  <script>alert(1)</script>\n{{marker}} 🪿', tags: 'indirect', builtin: false };

describe('Agent chat history and technique table', () => {
  let callbacks: { token: (s: string) => void; done: (ok: boolean) => void; table: (rows: any[]) => void };
  let requests: any[][];
  let backend: any;
  let api: any;
  const makeStore = () => TestBed.runInInjectionContext(() => new OrganizerChatStore());

  beforeEach(() => {
    localStorage.clear(); requests = [];
    backend = { backendUrl: 'test-backend', hub: signal('connected'), onOrganizerPageAction: vi.fn(),
      organizerChat: vi.fn(async (messages, token, _tool, done, _reasoning, table) => {
        requests.push(structuredClone(messages)); callbacks = { token, done, table };
      }) };
    api = { organizerSystem: async () => ({ prompt: '', isCustom: false }), organizerDocs: async () => [], knowledge: async () => [], settings: async () => ({ model: 'test/model' }), organizerFiles: async () => [], deleteOrganizerFiles: async () => {} };
    TestBed.configureTestingModule({ providers: [
      { provide: BackendService, useValue: backend }, { provide: ArenaService, useValue: { available: false } },
      { provide: ToastService, useValue: { err: vi.fn(), ok: vi.fn() } }, { provide: ApiService, useValue: api },
    ] });
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('restores messages and exact table examples after a new store is created', async () => {
    const store = makeStore();
    await store.send('show techniques'); callbacks.table([technique]); callbacks.token('Shown.'); callbacks.done(true);
    const restored = makeStore();
    expect(restored.view().find(v => v.type === 'techniques')?.techniques?.[0].example).toBe(technique.example);
    await restored.send('continue');
    expect(requests.at(-1)).toEqual([{ role: 'user', content: 'show techniques' }, { role: 'assistant', content: 'Shown.' }, { role: 'user', content: 'continue' }]);
    callbacks.done(true);
  });

  it('keeps new and reopened conversations isolated, and persists deletion', async () => {
    const store = makeStore();
    await store.send('first'); callbacks.token('answer one'); callbacks.done(true);
    const firstId = store.activeId(); store.newChat();
    await store.send('second'); callbacks.done(true);
    expect(requests.at(-1)).toEqual([{ role: 'user', content: 'second' }]);
    store.selectChat(firstId); await store.send('follow-up'); callbacks.done(true);
    expect(requests.at(-1)?.map(m => m.content)).toEqual(['first', 'answer one', 'follow-up']);
    store.deleteChat();
    const restored = makeStore();
    expect(restored.sessions()).toHaveLength(1);
    expect(restored.view()[0].text).toBe('second');
  });

  it('blocks switching/deletion during streaming and checkpoints continuous partial output', async () => {
    vi.useFakeTimers();
    const store = makeStore(); await store.send('first');
    const id = store.activeId(); store.newChat(); store.selectChat('other'); store.deleteChat();
    expect(store.activeId()).toBe(id); expect(store.sessions()).toHaveLength(1);
    callbacks.token('part 1'); vi.advanceTimersByTime(250); callbacks.token(' part 2'); vi.advanceTimersByTime(250);
    expect(readAgentHistory(localStorage.getItem(key))?.sessions[0].view.at(-1)?.text).toBe('part 1 part 2');
    const restored = makeStore();
    expect(restored.streaming()).toBe(false);
    expect(restored.view().at(-1)?.text).toContain('interrupted');
    expect(makeStore().view()).toHaveLength(restored.view().length);
    callbacks.done(false);
  });

  it('preserves unreadable history instead of overwriting it', async () => {
    localStorage.setItem(key, '{broken');
    const store = makeStore(); await store.send('new'); callbacks.done(true);
    expect(store.historyError()).toContain('could not be read');
    expect(localStorage.getItem(key)).toBe('{broken');
  });

  it('keeps the chat usable when local storage is full', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const store = makeStore(); await store.send('hello'); callbacks.token('reply'); callbacks.done(true);
    expect(store.view().at(-1)?.text).toBe('reply'); expect(store.streaming()).toBe(false);
    expect(store.historyError()).toContain('could not be saved');
  });

  it('persists clickable uploaded-file cards without inserting their contents into model context', async () => {
    const store = makeStore(); const file = { id: 'upload-id', name: 'notes.md', size: 12, createdAt: '2026-10-26T12:00:00Z', source: 'upload' as const };
    store.beginUpload(); expect(store.uploading()).toBe(true); store.recordFile(file); store.uploading.set(false);
    const restored = makeStore(); expect(restored.view()[0].file).toEqual(file);
    await restored.send('Review the attached notes');
    expect(requests.at(-1)).toEqual([{ role: 'user', content: 'Review the attached notes' }]); callbacks.done(true);
    const fixture = TestBed.createComponent(OrganizerPage); fixture.detectChanges();
    const page = fixture.componentInstance; page.chat.recordFile(file); page.showFiles.set(false); fixture.detectChanges();
    (fixture.nativeElement.querySelector('.file-card') as HTMLButtonElement).click();
    expect(page.showFiles()).toBe(true); expect(page.fileFocus()?.id).toBe('upload-id');
  });

  it('uses neutral titles, preserves a custom rename and migrates old first-message titles', async () => {
    const store = makeStore();
    await store.send('Do not make this the title'); callbacks.done(true);
    expect(store.currentTitle()).toMatch(/^Session · /);
    expect(store.currentTitle()).not.toContain('Do not');
    store.renameChat('Release investigation');
    await store.send('another turn'); callbacks.done(true);
    expect(makeStore().currentTitle()).toBe('Release investigation');
    const history = readAgentHistory(localStorage.getItem(key))!;
    delete history.sessions[0].titleSource;
    history.sessions[0].title = 'Do not make this the title';
    localStorage.setItem(key, JSON.stringify(history));
    const restored = makeStore();
    expect(restored.currentTitle()).toMatch(/^Session · /);
    expect(restored.view()[0].text).toBe('Do not make this the title');
  });

  it('hides system prompt and knowledge base behind Instructions and preserves editor actions', async () => {
    api.organizerSystem = async () => ({ prompt: 'Existing instructions', isCustom: true });
    api.organizerDocs = async () => [{ name: 'overview.md', content: 'Existing docs' }];
    api.setOrganizerSystem = vi.fn(async () => {});
    const fixture = TestBed.createComponent(OrganizerPage); await fixture.whenStable(); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#agent-instructions')).toBeNull();
    const toggle = root.querySelector('[aria-controls="agent-instructions"]') as HTMLButtonElement;
    toggle.click(); fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('#agent-instructions')?.textContent).toContain('knowledge base');
    expect(root.querySelector('#agent-instructions')?.textContent).toContain('system prompt');
    fixture.componentInstance.sysPrompt = 'Updated instructions';
    await fixture.componentInstance.saveSys();
    expect(api.setOrganizerSystem).toHaveBeenCalledWith('Updated instructions');
    toggle.click(); fixture.detectChanges(); expect(root.querySelector('#agent-instructions')).toBeNull();
  });

  it('sends with Enter, keeps Shift+Enter and IME composition, and keeps a draft while streaming', async () => {
    const fixture = TestBed.createComponent(OrganizerPage); fixture.detectChanges();
    const page = fixture.componentInstance;
    page.input = 'draft';
    const shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true });
    page.composerKeydown(shift); expect(shift.defaultPrevented).toBe(false); expect(requests).toHaveLength(0);
    page.composerKeydown(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })); expect(requests).toHaveLength(0);
    page.composerKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(requests[0]).toEqual([{ role: 'user', content: 'draft' }]); expect(page.input).toBe('');
    page.input = 'next draft'; page.composerKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(page.input).toBe('next draft'); expect(requests).toHaveLength(1); callbacks.done(true);
  });

  it('renders the tool table as escaped text, including an empty-library state', async () => {
    const fixture = TestBed.createComponent(OrganizerPage);
    const store = fixture.componentInstance.chat;
    await store.send('show'); callbacks.table([technique]); callbacks.done(true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('table')?.textContent).toContain(technique.title);
    expect(root.querySelector('table pre')?.textContent).toContain(technique.example);
    expect(root.querySelector('script, img')).toBeNull();
    await store.send('show empty'); callbacks.table([]); callbacks.done(true); fixture.detectChanges();
    expect(root.textContent).toContain('No techniques in the library yet.');
  });
});
