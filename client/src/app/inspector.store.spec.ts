import { TestBed } from '@angular/core/testing';
import { InspectorStore } from './inspector.store';
import { ApiService } from './api.service';
import { BackendService, OrganizerOpen } from './backend.service';

describe('Inspector data preservation and MCP files', () => {
  let open: (item: OrganizerOpen) => void;
  let api: any;
  beforeEach(() => {
    api = {
      techniques: async () => [{ id: 7, title: 'Technique', summary: 'Summary', whenItWorks: 'Requires a matching surface', example: 'Example', tags: 'indirect', builtin: true }],
      updateTechnique: vi.fn(async () => {}),
      organizerFile: vi.fn(async () => ({ file: { name: 'report.md' }, content: 'Exact file content' })),
      updateOrganizerFile: vi.fn(async () => {}),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: ApiService, useValue: api },
      { provide: BackendService, useValue: { onOrganizerOpen: (cb: typeof open) => { open = cb; }, onOrganizerChanged: vi.fn() } },
    ] });
  });

  it('preserves applicability on unrelated edits and saves intentional applicability edits', async () => {
    const store = TestBed.inject(InspectorStore);
    await store.openTechnique(7); store.patch('title', 'Renamed'); await store.save();
    expect(api.updateTechnique).toHaveBeenLastCalledWith(7, expect.objectContaining({ title: 'Renamed', whenItWorks: 'Requires a matching surface' }));
    store.patch('whenItWorks', 'New prerequisites'); await store.save();
    expect(api.updateTechnique).toHaveBeenLastCalledWith(7, expect.objectContaining({ whenItWorks: 'New prerequisites' }));
  });

  it('opens and saves a file using the session attached to the MCP event', async () => {
    const store = TestBed.inject(InspectorStore);
    open({ kind: 'file', id: 'file-7', sessionId: 'session-A' });
    await vi.waitFor(() => expect(store.current()?.kind).toBe('file'));
    expect(api.organizerFile).toHaveBeenCalledWith('session-A', 'file-7');
    store.patch('content', 'Updated file'); await store.save();
    expect(api.updateOrganizerFile).toHaveBeenCalledWith('session-A', 'file-7', 'Updated file');
    open({ kind: 'file', id: 'other-session-file' });
    await Promise.resolve();
    expect(api.organizerFile).toHaveBeenCalledTimes(1);
  });
});
