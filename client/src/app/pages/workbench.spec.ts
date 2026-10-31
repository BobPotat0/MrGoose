import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { WorkbenchPage } from './workbench';
import { BackendService } from '../backend.service';
import { ArenaService } from '../arena.service';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';

describe('Workbench cancellation lifecycle', () => {
  it('waits for backend completion before allowing another send and never offers a stopped partial as crafted', async () => {
    let complete!: () => void;
    const backend = {
      attackerSend: vi.fn(async (_req, token, _tool, done) => {
        token('Partial answer');
        await new Promise<void>(resolve => { complete = resolve; });
        done(false);
      }),
      stopAttacker: vi.fn(async () => true),
    };
    TestBed.configureTestingModule({ providers: [
      { provide: BackendService, useValue: backend },
      { provide: ArenaService, useValue: {} },
      { provide: ApiService, useValue: {} },
      { provide: ToastService, useValue: { err: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
    ] });
    vi.spyOn(WorkbenchPage.prototype, 'load').mockResolvedValue();
    vi.spyOn(WorkbenchPage.prototype, 'onSelect').mockResolvedValue();
    const page = TestBed.runInInjectionContext(() => new WorkbenchPage());
    page.promptDraft = 'Context'; page.input = 'First';
    const running = page.send();
    await page.stop();
    expect(backend.stopAttacker).toHaveBeenCalledWith(backend.attackerSend.mock.calls[0][0].requestId);
    expect(page.streaming()).toBe(true); expect(page.stopping()).toBe(true);
    page.input = 'Second'; await page.send(); expect(backend.attackerSend).toHaveBeenCalledTimes(1);
    complete(); await running;
    expect(page.streaming()).toBe(false); expect(page.stopping()).toBe(false);
    expect(page.crafted()).toBe(''); expect(page.aStep()).toBe('craft');
    vi.restoreAllMocks();
  });
});
