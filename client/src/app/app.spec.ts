import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { App } from './app';
import { BackendService } from './backend.service';
import { AgentChatStore } from './agent-chat.store';
import { ApiService } from './api.service';
import { ArenaService } from './arena.service';

// Shell checks use no backend, model or arena network calls.
describe('Workspace sidebar', () => {
  beforeEach(() => {
    vi.useFakeTimers(); localStorage.clear();
    TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([]),
      { provide: BackendService, useValue: {
        backendUrl: 'sidebar-test', inElectron: false, init: async () => {}, onAgentPageAction: vi.fn(),
        health: signal('ok'), hub: signal('connected'), lastEvent: signal('ready'), backendVersion: signal('test'),
        agentChat: async (_m: unknown, _t: unknown, _tool: unknown, done: (ok: boolean) => void) => done(true),
      } },
      { provide: ApiService, useValue: { settings: async () => ({ hasKey: true }), usage: async () => ({ hasKey: true }) } },
      { provide: ArenaService, useValue: {} },
    ] });
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('keeps every route under Workspace, Libraries and Settings', () => {
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const links = [...root.querySelectorAll('.sidebar a')].map(a => a.getAttribute('href'));
    expect(links).toEqual(['/assistant', '/workbench', '/prompts', '/techniques', '/challenges', '/settings']);
    expect(root.querySelector('nav')?.textContent).toContain('Workspace');
    expect(root.querySelector('nav')?.textContent).toContain('Libraries');
    expect(root.querySelector('[aria-label="Agent sessions"]')).not.toBeNull();
  });

  it('opens a saved session from another page and blocks switching while streaming', async () => {
    const fixture = TestBed.createComponent(App); const app = fixture.componentInstance;
    const chat = TestBed.inject(AgentChatStore); const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await chat.send('first message'); chat.renameChat('Review session');
    const id = chat.activeId(); chat.newChat(); fixture.detectChanges();
    const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.session-item')];
    buttons.find(b => b.textContent?.includes('Review session'))!.click();
    expect(chat.activeId()).toBe(id); expect(navigate).toHaveBeenCalledWith(['/assistant']);
    chat.streaming.set(true); navigate.mockClear(); app.newSession(); app.openSession('other');
    expect(chat.activeId()).toBe(id); expect(navigate).not.toHaveBeenCalled();
  });
});
