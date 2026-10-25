import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { TechniqueDto, TechniqueTagDto } from '../models';

@Component({
  selector: 'mg-techniques',
  imports: [FormsModule],
  template: `
    <section class="page">
      <header class="page-head">
        <span class="label-mono">Technique Library</span>
        <h1>Technique Library</h1>
        <p class="sub">The Gray Swan jailbreak / IPI technique catalog — color-coded by tactic, with when-it-works notes and examples. Built-ins restore on reset; add your own and tag them.</p>
      </header>

      <!-- toolbar: search + status filters + actions -->
      <div class="card">
        <div class="row">
          <input class="input grow" [(ngModel)]="search" placeholder="search title / summary / example…" />
          <button class="btn" [class.primary]="statusFilter()==='all'" (click)="statusFilter.set('all')">all</button>
          <button class="btn" [class.primary]="statusFilter()==='builtin'" (click)="statusFilter.set('builtin')">built-in</button>
          <button class="btn" [class.primary]="statusFilter()==='custom'" (click)="statusFilter.set('custom')">custom</button>
          <span class="grow"></span>
          <button class="btn" (click)="tagEditor.set(!tagEditor())">tags…</button>
          <button class="btn" (click)="export()">export</button>
          <label class="btn">import<input type="file" accept=".json" hidden (change)="import($event)" /></label>
          <button class="btn danger" (click)="reset()">reset built-ins</button>
        </div>
        <!-- tag filter chips -->
        <div class="row" style="flex-wrap:wrap;margin-top:10px;gap:6px">
          @for (t of tags(); track t.id) {
            <span class="chip" style="cursor:pointer" [style.background]="tagFilter().has(t.key) ? t.color : 'transparent'"
                  [style.color]="tagFilter().has(t.key) ? '#0a0a0b' : t.color" [style.border]="'1px solid ' + t.color"
                  (click)="toggleTagFilter(t.key)" [title]="t.description">{{ t.key }}</span>
          }
          @if (tagFilter().size) { <span class="chip" style="cursor:pointer" (click)="tagFilter.set(emptySet())">× clear</span> }
        </div>
      </div>

      <!-- tag registry editor -->
      @if (tagEditor()) {
        <div class="card alt">
          <span class="label-mono">tag registry</span>
          <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:10px">
            @for (t of tags(); track t.id) {
              <div class="row" style="gap:6px;border:1px solid var(--surface-3);border-radius:6px;padding:4px 8px">
                <input type="color" [(ngModel)]="t.color" (change)="saveTag(t)" style="width:26px;height:26px;border:none;background:none;padding:0" />
                <span class="mono" style="min-width:90px">{{ t.key }}</span>
                <input class="input" style="max-width:220px" [(ngModel)]="t.description" (blur)="saveTag(t)" placeholder="description" />
                <button class="btn danger" (click)="delTag(t)">×</button>
              </div>
            }
          </div>
          <div class="row" style="margin-top:10px">
            <input class="input" style="max-width:150px" [(ngModel)]="newTag.key" placeholder="new-tag-key" />
            <input type="color" [(ngModel)]="newTag.color" style="width:32px;height:32px;border:none;background:none" />
            <input class="input grow" [(ngModel)]="newTag.description" placeholder="description" />
            <button class="btn primary" (click)="addTag()" [disabled]="!newTag.key?.trim()">+ tag</button>
          </div>
        </div>
      }

      <!-- new / edit technique -->
      <div class="card">
        <span class="label-mono">{{ editingId() ? 'edit technique' : 'new technique' }}</span>
        <div class="row" style="margin-top:8px">
          <input class="input grow" [(ngModel)]="draft.title" placeholder="title" />
        </div>
        <input class="input" style="margin-top:8px" [(ngModel)]="draft.summary" placeholder="summary — what it is" />
        <textarea class="textarea" style="margin-top:8px" [(ngModel)]="draft.example" placeholder="example…"></textarea>
        <!-- tag multi-select -->
        <div class="row" style="flex-wrap:wrap;gap:6px;margin-top:10px">
          <span class="muted" style="font-size:11px">tags:</span>
          @for (t of tags(); track t.id) {
            <span class="chip" style="cursor:pointer" [style.background]="draftTags().has(t.key) ? t.color : 'transparent'"
                  [style.color]="draftTags().has(t.key) ? '#0a0a0b' : t.color" [style.border]="'1px solid ' + t.color"
                  (click)="toggleDraftTag(t.key)">{{ t.key }}</span>
          }
        </div>
        <div class="row" style="margin-top:10px">
          <span class="grow"></span>
          @if (editingId()) { <button class="btn ghost" (click)="resetDraft()">cancel</button> }
          <button class="btn primary" (click)="save()" [disabled]="!draft.title?.trim()">{{ editingId() ? 'save' : 'add' }}</button>
        </div>
      </div>

      <div class="row spread" style="margin:14px 2px 8px"><span class="label-mono">{{ filtered().length }} / {{ items().length }} techniques</span></div>
      <!-- 3-column header: name·tags | description | example -->
      <div class="tgrid thead"><span class="label-mono">name · tags</span><span class="label-mono">description</span><span class="label-mono">example</span></div>
      @for (t of filtered(); track t.id) {
        <div class="card alt tgrid">
          <div>
            <strong>{{ t.title }}</strong>
            @if (t.builtin) { <span class="chip" style="background:var(--surface-3);color:var(--muted);margin-left:6px">built-in</span> }
            <div class="row" style="flex-wrap:wrap;gap:5px;margin-top:7px">
              @for (tag of tagList(t); track tag) { <span class="chip" [style.border]="'1px solid ' + tagColor(tag)" [style.color]="tagColor(tag)">{{ tag }}</span> }
            </div>
            <div class="row" style="margin-top:9px;gap:6px">
              <button class="btn" style="height:24px;padding:2px 10px" (click)="edit(t)">edit</button>
              @if (!t.builtin) { <button class="btn danger" style="height:24px;padding:2px 10px" (click)="del(t)">del</button> }
            </div>
          </div>
          <div>
            @if (t.summary) { <p class="dim" style="margin:0">{{ t.summary }}</p> }
          </div>
          <div>
            @if (t.example) { <pre class="mono dim" style="margin:0;white-space:pre-wrap;font-size:11.5px;line-height:1.5">{{ t.example }}</pre> } @else { <span class="muted" style="font-size:11px">—</span> }
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .tgrid { display:grid; grid-template-columns:1.05fr 1.5fr 1.5fr; gap:16px; align-items:start; }
    .tgrid.thead { padding:0 14px 2px; }
    @media (max-width:860px){ .tgrid{ grid-template-columns:1fr; gap:8px; } .tgrid.thead{ display:none; } }
  `],
})
export class TechniquesPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  readonly items = signal<TechniqueDto[]>([]);
  readonly tags = signal<TechniqueTagDto[]>([]);
  readonly editingId = signal<number | null>(null);
  readonly statusFilter = signal<'all' | 'builtin' | 'custom'>('all');
  readonly tagFilter = signal<Set<string>>(new Set());
  readonly tagEditor = signal(false);
  readonly draftTags = signal<Set<string>>(new Set());
  search = '';
  draft: Partial<TechniqueDto> = {};
  newTag: Partial<TechniqueTagDto> = { color: '#6b7280' };
  emptySet(): Set<string> { return new Set(); }

  readonly filtered = computed(() => {
    const q = this.search.trim().toLowerCase();
    const sf = this.statusFilter();
    const tf = this.tagFilter();
    return this.items().filter(t => {
      if (sf === 'builtin' && !t.builtin) return false;
      if (sf === 'custom' && t.builtin) return false;
      if (tf.size && !this.tagList(t).some(x => tf.has(x))) return false;
      if (q && !(`${t.title} ${t.summary} ${t.whenItWorks} ${t.example} ${t.tags}`.toLowerCase().includes(q))) return false;
      return true;
    });
  });

  constructor() { this.load(); }
  async load() {
    this.items.set(await this.api.techniques());
    this.tags.set(await this.api.techniqueTags());
  }

  tagList(t: TechniqueDto): string[] { return (t.tags ?? '').split(',').map(x => x.trim()).filter(Boolean); }
  tagColor(key: string): string { return this.tags().find(t => t.key === key)?.color ?? '#9ca3af'; }
  toggleTagFilter(key: string) { const s = new Set(this.tagFilter()); s.has(key) ? s.delete(key) : s.add(key); this.tagFilter.set(s); }
  toggleDraftTag(key: string) { const s = new Set(this.draftTags()); s.has(key) ? s.delete(key) : s.add(key); this.draftTags.set(s); this.draft.tags = [...s].join(','); }

  edit(t: TechniqueDto) { this.draft = { ...t }; this.draftTags.set(new Set(this.tagList(t))); this.editingId.set(t.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  resetDraft() { this.draft = {}; this.draftTags.set(new Set()); this.editingId.set(null); }
  async save() {
    this.draft.tags = [...this.draftTags()].join(',');
    if (this.editingId()) { await this.api.updateTechnique(this.editingId()!, this.draft); this.toast.ok('technique saved'); }
    else { await this.api.addTechnique(this.draft); this.toast.ok('technique added'); }
    this.resetDraft(); await this.load();
  }
  async del(t: TechniqueDto) { await this.api.deleteTechnique(t.id); await this.load(); this.toast.ok('deleted'); }

  async reset() { const r = await this.api.resetTechniques(); await this.load(); this.toast.ok(`restored ${r.written} built-ins`); }
  async export() {
    const data = await this.api.exportTechniques();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mrgoose-techniques.json'; a.click();
    URL.revokeObjectURL(a.href); this.toast.ok('exported');
  }
  async import(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    try { const data = JSON.parse(await file.text()); const r = await this.api.importTechniques(data); await this.load(); this.toast.ok(`imported ${r.imported}`); }
    catch { this.toast.err('invalid JSON'); }
  }

  // tag registry
  async addTag() { await this.api.saveTechniqueTag(this.newTag); this.newTag = { color: '#6b7280' }; this.tags.set(await this.api.techniqueTags()); }
  async saveTag(t: TechniqueTagDto) { await this.api.saveTechniqueTag(t); }
  async delTag(t: TechniqueTagDto) { await this.api.deleteTechniqueTag(t.id); this.tags.set(await this.api.techniqueTags()); }
}
