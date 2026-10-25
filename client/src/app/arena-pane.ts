import { AfterViewInit, Component, ElementRef, EventEmitter, OnDestroy, Output, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArenaService } from './arena.service';
import { ApiService } from './api.service';
import { ArenaTab } from './models';

/**
 * Reusable embedded-arena pane: tab strip + the native WebContentsView host (bounds-synced) +
 * pick-element. Dropped beside the crafter in Attack / Chatbot so the page and the cockpit are
 * co-visible. Fill/read happen from the crafter via ArenaService; this pane owns embedding + tabs.
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
        <button class="btn" (click)="newTab()">+ tab</button>
        <button class="btn" (click)="pick()">pick element</button>
      </div>
      <div #host style="flex:1;min-height:360px;border:1px solid var(--border);border-radius:var(--radius-lg);
           display:flex;align-items:center;justify-content:center;color:var(--text-mute)" class="mono">
        open a tab to embed the real arena page here
      </div>
      @if (pickedSel()) { <p class="mono dim" style="margin-top:6px;font-size:11px">picked → {{ pickedSel() }}</p> }
    }
  `,
  styles: [':host{display:flex;flex-direction:column;min-height:0;flex:1}'],
})
export class ArenaPaneComponent implements AfterViewInit, OnDestroy {
  private arena = inject(ArenaService);
  private api = inject(ApiService);
  @ViewChild('host') hostRef?: ElementRef<HTMLElement>;
  @Output() picked = new EventEmitter<string>();

  readonly available = this.arena.available;
  readonly tabs = signal<ArenaTab[]>([]);
  readonly pickedSel = signal('');
  arenaUrl = 'https://app.grayswan.ai/arena/challenge/ipi-black-2026';
  private ro?: ResizeObserver;
  private onMove = () => this.sync();

  async ngAfterViewInit() {
    if (!this.available) return;
    try { this.arenaUrl = (await this.api.settings()).arenaUrl || this.arenaUrl; } catch { /* backend down */ }
    this.tabs.set(await this.arena.list());
    await this.arena.setVisible(true);
    this.sync();
    this.ro = new ResizeObserver(() => this.sync());
    if (this.hostRef) this.ro.observe(this.hostRef.nativeElement);
    window.addEventListener('resize', this.onMove);
    window.addEventListener('scroll', this.onMove, true);
  }
  ngOnDestroy() {
    this.arena.setVisible(false);
    this.ro?.disconnect();
    window.removeEventListener('resize', this.onMove);
    window.removeEventListener('scroll', this.onMove, true);
  }
  private sync() { const r = this.hostRef?.nativeElement.getBoundingClientRect(); if (r) this.arena.setBounds({ x: r.x, y: r.y, width: r.width, height: r.height }); }

  async newTab() { await this.arena.create(this.arenaUrl); this.tabs.set(await this.arena.list()); this.sync(); }
  async select(id: string) { this.tabs.set(await this.arena.select(id)); this.sync(); }
  async close(id: string) { this.tabs.set(await this.arena.close(id)); }
  async pick() { const r = await this.arena.pick(); if (r.selector) { this.pickedSel.set(r.selector); this.picked.emit(r.selector); } }
  short(s: string) { return s.length > 18 ? s.slice(0, 18) + '…' : s; }
}
