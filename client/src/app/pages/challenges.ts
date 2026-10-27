import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { ChallengeSummary, ChallengeDetail, ScenarioDto } from '../models';

@Component({
  selector: 'mg-challenges',
  imports: [FormsModule],
  templateUrl: './challenges.html',
  styleUrl: './library-page.css',
})
export class ChallengesPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly challenges = signal<ChallengeSummary[]>([]);
  readonly detail = signal<ChallengeDetail | null>(null);
  readonly editingId = signal<number | null>(null);
  readonly importing = signal(false);
  readonly importStatus = signal('');
  readonly editorOpen = signal(false);
  readonly createOpen = signal(false);
  readonly importOpen = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly creating = signal(false);
  readonly error = signal('');
  readonly search = signal('');
  readonly typeFilter = signal('all');
  readonly selectedId = signal<number | null>(null);
  readonly typeFilters = [
    { value: 'all', label: 'All objectives' },
    { value: 'ipi', label: 'IPI' },
    { value: 'direct', label: 'Direct' },
  ];
  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase(),
      type = this.typeFilter();
    return (this.detail()?.scenarios ?? []).filter(
      (s) =>
        (type === 'all' || s.type === type) &&
        (!q ||
          `${s.code} ${s.name} ${s.objective} ${s.criteria} ${s.area}`.toLowerCase().includes(q)),
    );
  });
  readonly selected = computed(
    () => this.filtered().find((s) => s.id === this.selectedId()) ?? this.filtered()[0] ?? null,
  );
  private detailRequest = 0;
  slug = 'ipi-black-2026';
  newSlug = '';
  newName = '';
  pageSrc = '';
  draft: Partial<ScenarioDto> = { type: 'ipi' };

  constructor() {
    this.load();
  }
  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      this.challenges.set(await this.api.challenges());
      if (!this.challenges().some((c) => c.slug === this.slug))
        this.slug = this.challenges()[0]?.slug ?? '';
      await this.loadDetail();
    } catch {
      this.error.set('Could not load the challenge library.');
      this.loading.set(false);
    }
  }
  async loadDetail() {
    const request = ++this.detailRequest,
      slug = this.slug;
    this.loading.set(true);
    this.error.set('');
    this.detail.set(null);
    try {
      const detail = slug ? await this.api.challenge(slug) : null;
      if (request === this.detailRequest) this.detail.set(detail);
    } catch {
      if (request === this.detailRequest) this.error.set('Could not load this challenge.');
    } finally {
      if (request === this.detailRequest) this.loading.set(false);
    }
  }
  changeChallenge(slug: string) {
    if (this.saving()) return;
    this.slug = slug;
    this.resetDraft();
    this.selectedId.set(null);
    this.clearFilters();
    void this.loadDetail();
  }
  clearFilters() {
    this.search.set('');
    this.typeFilter.set('all');
  }
  private revealEditor() {
    requestAnimationFrame(() =>
      this.host.nativeElement
        .querySelector('.objective-editor')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  }
  startNew() {
    if (this.saving()) return;
    this.resetDraft();
    this.editorOpen.set(true);
    this.revealEditor();
  }
  scenariosOf(type: string): ScenarioDto[] {
    return (this.detail()?.scenarios ?? []).filter((s) => s.type === type);
  }
  markerStr(s: ScenarioDto) {
    return (s.markers ?? []).map((m) => m.token).join('  ');
  }

  async createChallenge() {
    if (this.creating() || !this.newSlug.trim() || !this.newName.trim()) return;
    this.creating.set(true);
    try {
      await this.api.createChallenge({ slug: this.newSlug.trim(), name: this.newName.trim() });
      this.slug = this.newSlug.trim();
      this.newSlug = '';
      this.newName = '';
      this.resetDraft();
      this.clearFilters();
      this.selectedId.set(null);
      this.createOpen.set(false);
      await this.load();
      this.toast.ok('challenge created');
    } catch {
      this.toast.err('Could not create challenge. Check the slug and try again.');
    } finally {
      this.creating.set(false);
    }
  }
  edit(s: ScenarioDto) {
    if (this.saving()) return;
    this.draft = { ...s };
    this.editingId.set(s.id);
    this.editorOpen.set(true);
    this.revealEditor();
  }
  resetDraft() {
    this.draft = { type: 'ipi' };
    this.editingId.set(null);
    this.editorOpen.set(false);
  }
  async save() {
    if (this.saving() || !this.draft.code?.trim() || !this.draft.name?.trim()) return;
    this.saving.set(true);
    try {
      const editing = !!this.editingId();
      if (editing) await this.api.updateScenario(this.editingId()!, this.draft);
      else await this.api.addScenario(this.slug, this.draft);
      this.resetDraft();
      await this.loadDetail();
      this.challenges.set(await this.api.challenges());
      this.toast.ok(editing ? 'objective saved' : 'objective added');
    } catch {
      this.toast.err('Could not save objective. Your draft is still open.');
    } finally {
      this.saving.set(false);
    }
  }
  async del(s: ScenarioDto) {
    await this.api.deleteScenario(s.id);
    await this.loadDetail();
    this.toast.ok('objective deleted');
  }

  async importPage() {
    if (!this.pageSrc.trim()) return;
    this.importing.set(true);
    try {
      const r = await this.api.importPageSource(this.pageSrc);
      this.importStatus.set((r?.notes ?? []).join(' · '));
      this.pageSrc = '';
      await this.load();
      this.toast.ok('page source imported');
    } catch {
      this.toast.err('import failed');
    }
    this.importing.set(false);
  }
}
