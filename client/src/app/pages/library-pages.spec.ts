import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { TechniquesPage } from './techniques';
import { ChallengesPage } from './challenges';
import { ChallengeDetail, ScenarioDto, TechniqueDto } from '../models';

const technique = (id: number, title: string, builtin = true): TechniqueDto => ({
  id,
  title,
  builtin,
  slug: '',
  summary: 'Summary',
  whenItWorks: 'Tool output',
  example: '<system>literal example</system>',
  tags: builtin ? 'indirect' : 'direct',
});
const scenario = (id: number, type = 'ipi'): ScenarioDto => ({
  id,
  type,
  code: `S${id}`,
  name: `Objective ${id}`,
  area: 'black-box',
  behaviorId: 'behavior',
  harmfulTask: '',
  benignTask: 'Benign task',
  objective: 'Objective',
  criteria: 'Success criteria',
  reference: 'Reference',
  judgeContext: 'Judge context',
  requiredSurface: 'tool.result',
  knownWall: 'Known wall',
  breaksDone: 0,
  breaksTotal: 2,
  markers: [{ token: '{{marker}}', variable: 'marker', field: 'body', type: 'string' }],
  surfaces: [],
  recon: [],
});
const challenge = (
  slug: string,
  scenarios = [scenario(1), scenario(2, 'direct')],
): ChallengeDetail => ({
  slug,
  name: slug,
  scenarios,
  models: [],
  wave: '',
  world: '',
  totalBreaks: 0,
});

describe('Library browsing and editing', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const toast = { ok: vi.fn(), err: vi.fn() };
  beforeEach(() => {
    api = {
      techniques: vi.fn().mockResolvedValue([technique(1, 'Alpha'), technique(2, 'Beta', false)]),
      techniqueTags: vi.fn().mockResolvedValue([]),
      updateTechnique: vi.fn().mockResolvedValue({}),
      challenges: vi
        .fn()
        .mockResolvedValue([{ slug: 'ipi-black-2026', name: 'Challenge', scenarios: 2 }]),
      challenge: vi.fn().mockResolvedValue(challenge('ipi-black-2026')),
      updateScenario: vi.fn().mockResolvedValue({}),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
  });

  it('filters techniques as the search text changes, including applicability', async () => {
    const f = TestBed.createComponent(TechniquesPage);
    await f.whenStable();
    f.detectChanges();
    const input = f.nativeElement.querySelector(
      '[aria-label="Search techniques"]',
    ) as HTMLInputElement;
    input.value = 'Beta';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(f.componentInstance.filtered().map((t) => t.id)).toEqual([2]);
    expect(f.nativeElement.querySelector('.detail-head h2').textContent).toBe('Beta');
    input.value = 'Tool output';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(f.componentInstance.filtered()).toHaveLength(2);
  });

  it('shows details without an editor and keeps payload examples literal', async () => {
    const f = TestBed.createComponent(TechniquesPage);
    await f.whenStable();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.editor-panel')).toBeNull();
    expect(f.nativeElement.querySelector('.payload').textContent).toBe(
      '<system>literal example</system>',
    );
    expect(f.nativeElement.querySelector('system')).toBeNull();
    f.nativeElement.querySelectorAll('.catalog-item')[1].click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.detail-head h2').textContent).toBe('Beta');
  });

  it('preserves applicability and tags when editing an existing technique', async () => {
    const f = TestBed.createComponent(TechniquesPage);
    await f.whenStable();
    const c = f.componentInstance;
    c.edit(c.items()[0]);
    c.draft.title = 'Updated';
    await c.save();
    expect(api['updateTechnique']).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ title: 'Updated', whenItWorks: 'Tool output', tags: 'indirect' }),
    );
    expect(c.editorOpen()).toBe(false);
  });

  it('keeps an unsaved technique draft open when saving fails', async () => {
    api['updateTechnique'].mockRejectedValue(new Error('offline'));
    const f = TestBed.createComponent(TechniquesPage);
    await f.whenStable();
    const c = f.componentInstance;
    c.edit(c.items()[0]);
    c.draft.summary = 'My draft';
    await c.save();
    expect(c.editorOpen()).toBe(true);
    expect(c.draft.summary).toBe('My draft');
    expect(c.saving()).toBe(false);
  });

  it('browses objectives by type and search while retaining criteria and markers', async () => {
    const f = TestBed.createComponent(ChallengesPage);
    await f.whenStable();
    f.detectChanges();
    const c = f.componentInstance;
    expect(f.nativeElement.querySelector('.editor-panel')).toBeNull();
    expect(f.nativeElement.querySelector('.detail-panel').textContent).toContain('{{marker}}');
    expect(f.nativeElement.querySelector('.detail-panel').textContent).toContain('Known wall');
    c.typeFilter.set('direct');
    c.search.set('S2');
    f.detectChanges();
    expect(c.filtered().map((s) => s.id)).toEqual([2]);
    expect(c.selected()?.id).toBe(2);
    expect(f.nativeElement.querySelector('.detail-panel').textContent).toContain('Judge context');
  });

  it('does not let a late challenge response replace the newly selected challenge', async () => {
    const f = TestBed.createComponent(ChallengesPage);
    await f.whenStable();
    let resolveOld!: (v: ChallengeDetail) => void;
    api['challenge'].mockImplementation((slug: string) =>
      slug === 'old'
        ? new Promise<ChallengeDetail>((r) => (resolveOld = r))
        : Promise.resolve(challenge(slug)),
    );
    const c = f.componentInstance;
    c.changeChallenge('old');
    c.changeChallenge('new');
    await Promise.resolve();
    resolveOld(challenge('old'));
    await Promise.resolve();
    await Promise.resolve();
    expect(c.detail()?.slug).toBe('new');
    expect(c.loading()).toBe(false);
  });

  it('preserves scenario metadata when saving edits and closes the editor', async () => {
    const f = TestBed.createComponent(ChallengesPage);
    await f.whenStable();
    const c = f.componentInstance;
    c.edit(c.detail()!.scenarios[0]);
    c.draft.name = 'Updated';
    await c.save();
    expect(api['updateScenario']).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        name: 'Updated',
        behaviorId: 'behavior',
        markers: [expect.objectContaining({ token: '{{marker}}' })],
        criteria: 'Success criteria',
      }),
    );
    expect(c.editorOpen()).toBe(false);
  });
});
