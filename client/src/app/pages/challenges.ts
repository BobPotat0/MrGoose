import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { ChallengeSummary, ChallengeDetail, ScenarioDto } from '../models';

@Component({
  selector: 'mg-challenges',
  imports: [FormsModule],
  template: `
    <section class="page">
      <header class="page-head">
        <span class="label-mono">Challenge Library</span>
        <h1>Challenge Library</h1>
        <p class="sub">Author the objectives both modes work from: IPI scenarios (surfaces + markers) for the Break Agent, and direct behaviors (success criteria) for the Break Chatbot.</p>
      </header>

      <div class="card">
        <div class="row">
          <select class="input" style="max-width:360px" [(ngModel)]="slug" (ngModelChange)="loadDetail()">
            @for (c of challenges(); track c.slug) { <option [value]="c.slug">{{ c.name }} ({{ c.scenarios }})</option> }
          </select>
          <span class="grow"></span>
          <input class="input" style="max-width:150px" [(ngModel)]="newSlug" placeholder="new-slug" />
          <input class="input" style="max-width:200px" [(ngModel)]="newName" placeholder="new challenge name" />
          <button class="btn" (click)="createChallenge()" [disabled]="!newSlug.trim() || !newName.trim()">+ challenge</button>
        </div>
      </div>

      <!-- import from page source: pull the operator's randomized model codenames + scenario descriptions -->
      <div class="card">
        <span class="label-mono">Import from page source</span>
        <p class="muted" style="font-size:12px;margin:6px 0">Model codenames are randomized per operator. Paste the Gray Swan chat page source (browser → View Source / Ctrl+U) to rebuild <strong>your</strong> model roster + break matrix and refresh scenario descriptions.</p>
        <textarea class="textarea" style="min-height:90px" [(ngModel)]="pageSrc" placeholder="paste the full chat page source here…"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn primary" (click)="importPage()" [disabled]="!pageSrc.trim() || importing()">{{ importing() ? 'importing…' : 'import page source' }}</button>
          @if (importStatus()) { <span class="muted" style="font-size:11px">{{ importStatus() }}</span> }</div>
      </div>

      <!-- objective editor -->
      <div class="card">
        <span class="label-mono">{{ editingId() ? 'edit objective' : 'new objective' }}</span>
        <div class="grid2" style="margin-top:10px">
          <div class="field"><label>code</label><input class="input" [(ngModel)]="draft.code" placeholder="WB2S5" /></div>
          <div class="field"><label>name</label><input class="input" [(ngModel)]="draft.name" placeholder="Exfiltrate Customer Records" /></div>
          <div class="field"><label>type</label><select class="input" [(ngModel)]="draft.type"><option value="ipi">ipi — injection scenario</option><option value="direct">direct — jailbreak behavior</option></select></div>
          <div class="field"><label>area</label><input class="input" [(ngModel)]="draft.area" placeholder="white-box / black-box / direct" /></div>
        </div>
        <div class="field" style="margin-top:10px"><label>objective</label><input class="input" [(ngModel)]="draft.objective" /></div>
        <div class="field" style="margin-top:10px"><label>success criteria</label><input class="input" [(ngModel)]="draft.criteria" /></div>
        @if (draft.type === 'ipi') {
          <div class="field" style="margin-top:10px"><label>benign task (the agent is given this)</label><input class="input" [(ngModel)]="draft.benignTask" /></div>
          <div class="field" style="margin-top:10px"><label>required surface</label><input class="input" [(ngModel)]="draft.requiredSurface" placeholder="e.g. gmail_send_email" /></div>
        } @else {
          <div class="field" style="margin-top:10px"><label>reference material (optional)</label><input class="input" [(ngModel)]="draft.reference" /></div>
          <div class="field" style="margin-top:10px"><label>extra judge context (optional)</label><input class="input" [(ngModel)]="draft.judgeContext" /></div>
        }
        <div class="row" style="margin-top:12px">
          <button class="btn primary" (click)="save()" [disabled]="!draft.code?.trim() || !draft.name?.trim()">{{ editingId() ? 'save' : 'add objective' }}</button>
          @if (editingId()) { <button class="btn ghost" (click)="resetDraft()">cancel</button> }
        </div>
      </div>

      @for (grp of ['ipi','direct']; track grp) {
        @if (scenariosOf(grp).length) {
          <h2 style="font-size:15px;margin:18px 0 8px">{{ grp === 'ipi' ? 'IPI scenarios' : 'Direct behaviors' }}</h2>
          @for (s of scenariosOf(grp); track s.id) {
            <div class="card alt">
              <div class="row spread">
                <div class="row" style="flex-wrap:wrap;gap:6px"><span class="chip lime">{{ s.code }}</span><strong>{{ s.name }}</strong><span class="chip">{{ s.area }}</span><span class="chip">{{ s.type }}</span>@if (s.breaksTotal) { <span class="dim" style="font-size:12px">{{ s.breaksDone }}/{{ s.breaksTotal }} breaks</span> }</div>
                <div class="row"><button class="btn" (click)="edit(s)">edit</button><button class="btn danger" (click)="del(s)">delete</button></div>
              </div>
              <div style="margin-top:10px;display:grid;gap:9px">
                <div><span class="label-mono">objective</span><p class="dim" style="margin:3px 0 0;white-space:pre-wrap">{{ s.objective || '—' }}</p></div>
                @if (s.harmfulTask) { <div><span class="label-mono" style="color:#f3a0a0">harmful task</span><p class="dim" style="margin:3px 0 0;white-space:pre-wrap">{{ s.harmfulTask }}</p></div> }
                @if (s.benignTask) { <div><span class="label-mono">benign task — what the operator actually asks the agent</span><p class="dim" style="margin:3px 0 0;white-space:pre-wrap">{{ s.benignTask }}</p></div> }
                @if (s.criteria) { <div><span class="label-mono" style="color:#34d399">success criteria</span><p style="margin:3px 0 0;font-size:12.5px;color:#34d399;white-space:pre-wrap">✓ {{ s.criteria }}</p></div> }
                @if (s.type === 'ipi' && s.requiredSurface) { <div><span class="label-mono">required surface</span><p class="mono dim" style="margin:3px 0 0;font-size:12px">{{ s.requiredSurface }}</p></div> }
                @if (s.surfaces?.length) { <div><span class="label-mono">injection surfaces (★ = guaranteed)</span>@for (f of s.surfaces; track f.key) { <p class="mono dim" style="margin:3px 0 0;font-size:12px">{{ f.required ? '★ ' : '• ' }}{{ f.key }} — {{ f.service }}.{{ f.action }} [{{ f.fieldsCsv }}]</p> }</div> }
                @if (s.markers?.length) { <div><span class="label-mono">markers (embed literally)</span><p class="mono dim" style="margin:3px 0 0;font-size:12px">{{ markerStr(s) }}</p></div> }
                @if (s.reference) { <div><span class="label-mono">reference material</span><p class="dim" style="margin:3px 0 0;font-size:12.5px;white-space:pre-wrap">{{ s.reference }}</p></div> }
                @if (s.judgeContext) { <div><span class="label-mono">extra judge context</span><p class="dim" style="margin:3px 0 0;font-size:12.5px;white-space:pre-wrap">{{ s.judgeContext }}</p></div> }
                @if (s.knownWall) { <div><span class="label-mono" style="color:#f3a0a0">known wall</span><p style="margin:3px 0 0;font-size:12.5px;color:#f3a0a0;white-space:pre-wrap">{{ s.knownWall }}</p></div> }
                @if (s.behaviorId) { <span class="mono muted" style="font-size:11px">id: {{ s.behaviorId }}</span> }
              </div>
            </div>
          }
        }
      }
    </section>
  `,
})
export class ChallengesPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  readonly challenges = signal<ChallengeSummary[]>([]);
  readonly detail = signal<ChallengeDetail | null>(null);
  readonly editingId = signal<number | null>(null);
  readonly importing = signal(false);
  readonly importStatus = signal('');
  slug = 'ipi-black-2026';
  newSlug = ''; newName = ''; pageSrc = '';
  draft: Partial<ScenarioDto> = { type: 'ipi' };

  constructor() { this.load(); }
  async load() {
    this.challenges.set(await this.api.challenges());
    if (!this.challenges().some(c => c.slug === this.slug)) this.slug = this.challenges()[0]?.slug ?? '';
    await this.loadDetail();
  }
  async loadDetail() { if (this.slug) this.detail.set(await this.api.challenge(this.slug)); }
  scenariosOf(type: string): ScenarioDto[] { return (this.detail()?.scenarios ?? []).filter(s => s.type === type); }
  markerStr(s: ScenarioDto) { return (s.markers ?? []).map(m => m.token).join('  '); }

  async createChallenge() {
    await this.api.createChallenge({ slug: this.newSlug.trim(), name: this.newName.trim() });
    this.slug = this.newSlug.trim(); this.newSlug = ''; this.newName = '';
    await this.load();
  }
  edit(s: ScenarioDto) { this.draft = { ...s }; this.editingId.set(s.id); }
  resetDraft() { this.draft = { type: 'ipi' }; this.editingId.set(null); }
  async save() {
    const editing = !!this.editingId();
    if (editing) await this.api.updateScenario(this.editingId()!, this.draft);
    else await this.api.addScenario(this.slug, this.draft);
    this.resetDraft();
    await this.loadDetail();
    this.challenges.set(await this.api.challenges());
    this.toast.ok(editing ? 'objective saved' : 'objective added');
  }
  async del(s: ScenarioDto) { await this.api.deleteScenario(s.id); await this.loadDetail(); this.toast.ok('objective deleted'); }

  async importPage() {
    if (!this.pageSrc.trim()) return;
    this.importing.set(true);
    try {
      const r = await this.api.importPageSource(this.pageSrc);
      this.importStatus.set((r?.notes ?? []).join(' · '));
      this.pageSrc = '';
      await this.load();
      this.toast.ok('page source imported');
    } catch { this.toast.err('import failed'); }
    this.importing.set(false);
  }
}
