import * as signalR from '@microsoft/signalr';
import { BackendService } from './backend.service';

describe('Agent technique event lifecycle', () => {
  it('registers the table listener before invoking and removes it on completion', async () => {
    const service = new BackendService();
    const handlers = new Map<string, Function>();
    const table = vi.fn(); const done = vi.fn(); const onFile = vi.fn();
    const rows = [{ id: 3, title: 'Current custom technique' }];
    const connection = {
      on: (name: string, fn: Function) => handlers.set(name, fn),
      off: (name: string, fn: Function) => { if (handlers.get(name) === fn) handlers.delete(name); },
      invoke: async (method: string, _messages: unknown, sessionId: string) => {
        expect(method).toBe('OrganizerChat'); expect(sessionId).toBe('test-session');
        handlers.get('organizerFile')!({ id: 'saved', name: 'report.md' });
        handlers.get('organizerTechniques')!(rows); handlers.get('organizerDone')!({ ok: true });
        throw new Error('Transport closes after completion');
      },
    };
    (service as any).connection = connection; service.hub.set('connected');
    await service.organizerChat([], vi.fn(), vi.fn(), done, undefined, table, onFile, 'test-session');
    expect(table).toHaveBeenCalledExactlyOnceWith(rows);
    expect(onFile).toHaveBeenCalledExactlyOnceWith({ id: 'saved', name: 'report.md' });
    expect(done).toHaveBeenCalledExactlyOnceWith(true);
    expect(handlers.size).toBe(0);
  });

  it('cleans up listeners when invocation fails, and reports offline sends', async () => {
    const service = new BackendService(); const done = vi.fn();
    await service.organizerChat([], vi.fn(), vi.fn(), done);
    expect(done).toHaveBeenCalledExactlyOnceWith(false);
    const handlers = new Map<string, Function>();
    (service as any).connection = {
      on: (name: string, fn: Function) => handlers.set(name, fn),
      off: (name: string) => handlers.delete(name), invoke: async () => { throw new Error('offline'); },
    };
    service.hub.set('connected'); done.mockClear();
    await service.organizerChat([], vi.fn(), vi.fn(), done);
    expect(done).toHaveBeenCalledExactlyOnceWith(false); expect(handlers.size).toBe(0);
  });
});


describe('Agent action registration from the sidebar store', () => {
  afterEach(() => vi.restoreAllMocks());
  it('delivers page actions when the handler is registered before the hub exists', async () => {
    const service = new BackendService(); const handler = vi.fn(); const events = new Map<string, Function>();
    service.onOrganizerPageAction(handler);
    const connection = {
      on: (name: string, fn: Function) => events.set(name, fn),
      onreconnecting: vi.fn(), onreconnected: vi.fn(), onclose: vi.fn(), start: async () => {}, invoke: async () => {},
    };
    vi.spyOn(signalR.HubConnectionBuilder.prototype, 'build').mockReturnValue(connection as any);
    await (service as any).connectHub();
    const action = { id: 'one', name: 'arena_list_tabs', args: '{}' };
    events.get('organizerPageAction')!(action);
    expect(handler).toHaveBeenCalledExactlyOnceWith(action);
  });
});
