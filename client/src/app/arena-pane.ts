import { AfterViewInit, Component, EventEmitter, OnDestroy, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArenaService } from './arena.service';
import { ApiService } from './api.service';
import { ArenaTab } from './models';

/**
 * Cockpit controls for the separate Arena window. Native views and their bounds are owned
 * by Electron, independent of this component's route, visibility and layout.
 */
@Component({
  selector: 'mg-arena-pane',
  imports: [FormsModule],
  template: `
    @if (!available) {
      <div class="banner" style="margin:0">Embedded arena runs only in the Electron app (<span class="mono">npm run dev</span>). Log in to Gray Swan once inside it.</div>
    } @else {
      <div class="row" style="margin-bottom:8px">
        <span class="label-mono">arena</span>
        @for (t of tabs(); track t.id) {
          <span class="chip act" [class.lime]="t.active" (click)="select(t.id)">{{ short(t.title || 'tab') }} <a (click)="close(t.id); $event.stopPropagation()">✕</a></span>
        }
        <span class="grow"></span>
        <button class="btn" (click)="show()">open Arena window</button>
        <button class="btn" (click)="newTab()">+ tab</button>
        <button class="btn" (click)="pick()">pick element</button>
      </div>
      <p class="muted">Arena runs in its own window. Review and launch there manually.</p>
      @if (pickedSel()) { <p class="mono dim" style="margin-top:6px;font-size:11px">picked → {{ pickedSel() }}</p> }
    }
  `,
  styles: [':host{display:flex;flex-direction:column;min-height:0;flex:1}'],
})
export class ArenaPaneComponent implements AfterViewInit, OnDestroy {
  private arena = inject(ArenaService);
  private api = inject(ApiService);
  @Output() picked = new EventEmitter<string>();

  readonly available = this.arena.available;
  readonly tabs = signal<ArenaTab[]>([]);
  readonly pickedSel = signal('');
  arenaUrl = 'https://app.grayswan.ai/arena/challenge/ipi-black-2026';
  private unsubscribe?: () => void;

  async ngAfterViewInit() {
    if (!this.available) return;
    try { this.arenaUrl = (await this.api.settings()).arenaUrl || this.arenaUrl; } catch { /* backend down */ }
    this.tabs.set(await this.arena.list());
    this.unsubscribe = this.arena.onChanged(tabs => this.tabs.set(tabs));
  }
  ngOnDestroy() {
    this.unsubscribe?.();
  }
  show() { return this.arena.show(); }
  async newTab() { await this.arena.create(this.arenaUrl); this.tabs.set(await this.arena.list()); }
  async select(id: string) { this.tabs.set(await this.arena.select(id)); }
  async close(id: string) { this.tabs.set(await this.arena.close(id)); }
  async pick() { const r = await this.arena.pick(); if (r.selector) { this.pickedSel.set(r.selector); this.picked.emit(r.selector); } }
  short(s: string) { return s.length > 18 ? s.slice(0, 18) + '…' : s; }
}
