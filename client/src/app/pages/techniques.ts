import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { TechniqueDto, TechniqueTagDto } from '../models';

@Component({
  selector: 'mg-techniques',
  imports: [FormsModule],
  templateUrl: './techniques.html',
  styleUrl: './library-page.css',
})
export class TechniquesPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly items = signal<TechniqueDto[]>([]);
  readonly tags = signal<TechniqueTagDto[]>([]);
  readonly editingId = signal<number | null>(null);
  readonly statusFilter = signal<'all' | 'builtin' | 'custom'>('all');
  readonly tagFilter = signal<Set<string>>(new Set());
  readonly tagEditor = signal(false);
  readonly draftTags = signal<Set<string>>(new Set());
  readonly search = signal('');
  readonly selectedId = signal<number | null>(null);
  readonly editorOpen = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly sourceFilters = [
    { value: 'all', label: 'All' },
    { value: 'builtin', label: 'Built-in' },
    { value: 'custom', label: 'Custom' },
  ] as const;
  draft: Partial<TechniqueDto> = {};
  newTag: Partial<TechniqueTagDto> = { color: '#6b7280' };
  emptySet(): Set<string> {
    return new Set();
  }

  readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const sf = this.statusFilter();
    const tf = this.tagFilter();
    return this.items().filter((t) => {
      if (sf === 'builtin' && !t.builtin) return false;
      if (sf === 'custom' && t.builtin) return false;
      if (tf.size && !this.tagList(t).some((x) => tf.has(x))) return false;
      if (
        q &&
        !`${t.title} ${t.summary} ${t.whenItWorks} ${t.example} ${t.tags}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  });
  readonly selected = computed(
    () => this.filtered().find((t) => t.id === this.selectedId()) ?? this.filtered()[0] ?? null,
  );
  clearFilters() {
    this.search.set('');
    this.statusFilter.set('all');
    this.tagFilter.set(new Set());
  }
  private revealEditor() {
    requestAnimationFrame(() =>
      this.host.nativeElement
        .querySelector('.editor-panel')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
  }
  startNew() {
    if (this.saving()) return;
    this.resetDraft();
    this.editorOpen.set(true);
    this.revealEditor();
  }
  async copyExample(t: TechniqueDto) {
    try {
      await navigator.clipboard.writeText(t.example);
      this.toast.ok('example copied');
    } catch {
      this.toast.err('Could not copy example');
    }
  }

  constructor() {
    this.load();
  }
  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const [items, tags] = await Promise.all([this.api.techniques(), this.api.techniqueTags()]);
      this.items.set(items);
      this.tags.set(tags);
    } catch {
      this.error.set('Could not load the technique library.');
    } finally {
      this.loading.set(false);
    }
  }

  tagList(t: TechniqueDto): string[] {
    return (t.tags ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  }
  tagColor(key: string): string {
    return this.tags().find((t) => t.key === key)?.color ?? '#9ca3af';
  }
  toggleTagFilter(key: string) {
    const s = new Set(this.tagFilter());
    s.has(key) ? s.delete(key) : s.add(key);
    this.tagFilter.set(s);
  }
  toggleDraftTag(key: string) {
    const s = new Set(this.draftTags());
    s.has(key) ? s.delete(key) : s.add(key);
    this.draftTags.set(s);
    this.draft.tags = [...s].join(',');
  }

  edit(t: TechniqueDto) {
    if (this.saving()) return;
    this.draft = { ...t };
    this.draftTags.set(new Set(this.tagList(t)));
    this.editingId.set(t.id);
    this.editorOpen.set(true);
    this.revealEditor();
  }
  resetDraft() {
    this.draft = {};
    this.draftTags.set(new Set());
    this.editingId.set(null);
    this.editorOpen.set(false);
  }
  async save() {
    if (this.saving() || !this.draft.title?.trim()) return;
    this.saving.set(true);
    try {
      this.draft.tags = [...this.draftTags()].join(',');
      if (this.editingId()) {
        await this.api.updateTechnique(this.editingId()!, this.draft);
        this.toast.ok('technique saved');
      } else {
        await this.api.addTechnique(this.draft);
        this.toast.ok('technique added');
      }
      this.resetDraft();
      await this.load();
    } catch {
      this.toast.err('Could not save technique. Your draft is still open.');
    } finally {
      this.saving.set(false);
    }
  }
  async del(t: TechniqueDto) {
    await this.api.deleteTechnique(t.id);
    await this.load();
    this.toast.ok('deleted');
  }

  async reset() {
    const r = await this.api.resetTechniques();
    await this.load();
    this.toast.ok(`restored ${r.written} built-ins`);
  }
  async export() {
    const data = await this.api.exportTechniques();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mrgoose-techniques.json';
    a.click();
    URL.revokeObjectURL(a.href);
    this.toast.ok('exported');
  }
  async import(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const r = await this.api.importTechniques(data);
      await this.load();
      this.toast.ok(`imported ${r.imported}`);
    } catch {
      this.toast.err('invalid JSON');
    }
  }

  // tag registry
  async addTag() {
    await this.api.saveTechniqueTag(this.newTag);
    this.newTag = { color: '#6b7280' };
    this.tags.set(await this.api.techniqueTags());
  }
  async saveTag(t: TechniqueTagDto) {
    await this.api.saveTechniqueTag(t);
  }
  async delTag(t: TechniqueTagDto) {
    await this.api.deleteTechniqueTag(t.id);
    this.tags.set(await this.api.techniqueTags());
  }
}
