import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { ModelInfo } from './models';

/// Reusable model-settings editor for one role (organizer | attacker): model + reasoning + temperature.
/// It reads/writes the SAME backend Settings keys ("{role}.model" etc.), so every place it is mounted —
/// the role's own tab AND the Settings tab — stays mirrored through the backend. Emits `changed` after a save
/// so a host (e.g. the Find Break context chip) can refresh its label.
@Component({
  selector: 'mg-model-settings',
  imports: [FormsModule],
  template: `
    <div class="ms-grid">
      <div class="ms-row">
        <span class="label-mono ms-lbl">model</span>
        <div class="row grow" style="min-width:0">
          <input class="input grow" [(ngModel)]="model" placeholder="model id — e.g. openai/gpt-4o-mini" />
          <button class="btn primary" (click)="save('model')">save</button>
        </div>
      </div>
      <div class="ms-row">
        <span class="label-mono ms-lbl"></span>
        <div class="row grow" style="min-width:0">
          <input class="input grow" [(ngModel)]="query" (ngModelChange)="search()" placeholder="search models… claude, gpt, kimi, free" />
          @if (searching()) { <span class="muted" style="font-size:11px">…</span> }
        </div>
      </div>
      @if (results().length) {
        <div style="max-height:220px;overflow:auto">
          @for (m of results(); track m.id) {
            <div class="card" style="margin-top:6px;padding:6px 9px;cursor:pointer" [style.border-color]="m.id===model ? 'var(--lime)' : ''" (click)="pick(m)">
              <div class="row spread"><span class="mono" style="font-size:12px" [style.color]="m.id===model ? 'var(--lime)' : 'var(--text)'">{{ m.id }}</span>@if (m.id===model) { <span class="chip lime">selected</span> }</div>
              <div class="muted" style="font-size:11px;margin-top:2px">{{ m.name }}@if (m.prompt) { <span class="mono"> · in {{ m.prompt }}/tok · out {{ m.completion }}/tok</span> }</div>
            </div>
          }
        </div>
      } @else if (query && !searching()) { <p class="muted" style="font-size:11px">no matches</p> }
      <div class="ms-row">
        <span class="label-mono ms-lbl">reasoning</span>
        <select class="input" [(ngModel)]="reasoning" (ngModelChange)="save('reasoning')" style="flex:0 0 auto;min-width:200px">
          <option value="default">Default (model decides)</option>
          <option value="off">Off — fastest</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div class="ms-row">
        <span class="label-mono ms-lbl">temperature</span>
        <input class="input" type="number" min="0" max="2" step="0.1" [(ngModel)]="temperature" (change)="save('temperature')" style="width:92px" />
        <span class="muted" style="font-size:11px">0 = deterministic · 2 = wild</span>
      </div>
    </div>
  `,
  styles: [`
    .ms-grid { display: flex; flex-direction: column; gap: 10px; }
    .ms-row { display: flex; align-items: center; gap: 10px; }
    .ms-lbl { flex: 0 0 auto; min-width: 86px; }
  `],
})
export class ModelSettingsComponent {
  readonly role = input.required<'organizer' | 'attacker'>();
  readonly changed = output<void>();
  private api = inject(ApiService);
  private toast = inject(ToastService);

  readonly results = signal<ModelInfo[]>([]);
  readonly searching = signal(false);
  model = ''; reasoning = 'default'; temperature = 0.7; query = '';
  private timer: any;

  constructor() { void this.load(); }

  async load() {
    try {
      const r = (await this.api.settings())[this.role()];
      this.model = r.model; this.reasoning = r.reasoning || 'default';
      this.temperature = typeof r.temperature === 'number' ? r.temperature : 0.7;
    } catch { /* backend down */ }
  }

  search() {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (!this.query.trim()) { this.results.set([]); return; }
      this.searching.set(true);
      try { this.results.set(await this.api.models(this.query.trim())); } catch { this.results.set([]); }
      this.searching.set(false);
    }, 250);
  }
  pick(m: ModelInfo) { this.model = m.id; this.results.set([]); this.query = ''; void this.save('model'); }

  async save(which: 'model' | 'reasoning' | 'temperature') {
    const role = this.role();
    const value = which === 'model' ? this.model.trim()
      : which === 'reasoning' ? this.reasoning
      : String(this.temperature);
    try { await this.api.setSetting(`${role}.${which}`, value); this.toast.ok(`${role} ${which} saved`); this.changed.emit(); }
    catch { this.toast.err('save failed'); }
  }
}
