import { AfterViewInit, Component, ElementRef, EventEmitter, OnDestroy, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArenaService } from './arena.service';
import { ApiService } from './api.service';
import { ArenaTab } from './models';

/**
 * Cockpit controls for the Gray Swan arena. The native WebContentsView is owned by Electron and,
 * when DOCKED, floats over the #host box here (bounds reported on resize/scroll). When DETACHED it
 * lives in its own window and this renders only a slim control bar. Fill/read only — the human launches.
 */
@Component({
  selector: 'mg-arena-pane',
  imports: [FormsModule],
  host: { '[class.compact]': '!docked()' },
  template: `
    @if (!available) {
      <div class="banner" style="margin: 0">
        Embedded arena runs only in the Electron app (<span class="mono">npm run dev</span>). Log in to Gray Swan once inside it.
      </div>
    } @else {
      <div class="row arena-bar" style="gap: 6px; flex-wrap: wrap" [style.margin-bottom]="docked() ? '6px' : '0'">
        <span class="label-mono">arena</span>
        @if (!docked()) { <span class="chip" style="opacity: 0.7">↗ own window</span> }
        @for (t of tabs(); track t.id) {
          <span class="chip act" [class.lime]="t.active" (click)="select(t.id)">
            {{ short(t.title || 'tab') }} <a (click)="close(t.id); $event.stopPropagation()">✕</a>
          </span>
        }
        <button class="btn" (click)="newTab()" title="Open a new Arena tab">+ tab</button>
        <span class="grow"></span>
        <button class="btn" (click)="pick()" title="Click a field in the arena to capture its selector">pick</button>
        @if (docked()) {
          <button class="btn" (click)="detach()" title="Pop the arena into its own window">⇱ detach</button>
        } @else {
          <button class="btn primary" (click)="dock()" title="Embed the arena back into the cockpit">⤓ dock</button>
        }
      </div>

      @if (tabs().length) {
        <div class="row arena-url" style="gap: 6px; margin-bottom: 6px; align-items: center">
          <span class="label-mono" style="opacity: 0.6">url</span>
          <input class="input mono" style="flex: 1; min-width: 0; font-size: 11px"
            [(ngModel)]="urlDraft" (focus)="urlFocused = true" (blur)="urlFocused = false; urlDraft = activeUrl()"
            (keydown.enter)="go()" spellcheck="false" autocapitalize="off"
            placeholder="https://… — type an address, Enter to go"
            title="Address of the active arena tab. Edit and press Enter to navigate; log in once here and the session stays signed in." />
          <button class="btn" (click)="go()" title="Go to this address">go</button>
        </div>
      }

      @if (docked()) {
        <div #host class="arena-host"></div>
      }
      @if (pickedSel()) {
        <p class="mono dim" style="margin-top: 6px; font-size: 11px">picked → {{ pickedSel() }}</p>
      }
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; flex: 1 }
    :host(.compact) { flex: 0 0 auto }
    .arena-host { flex: 1; min-height: 0; border: 1px solid var(--surface-3); border-radius: 6px; background: var(--surface-1) }
  `],
})
export class ArenaPaneComponent implements AfterViewInit, OnDestroy {
  private arena = inject(ArenaService);
  private api = inject(ApiService);
  @Output() picked = new EventEmitter<string>();
  @Output() dockedChange = new EventEmitter<boolean>();
  @ViewChild('host') hostRef?: ElementRef<HTMLElement>;

  readonly available = this.arena.available;
  readonly tabs = signal<ArenaTab[]>([]);
  readonly activeUrl = computed(() => this.tabs().find(t => t.active)?.url || '');
  readonly docked = signal(true);
  readonly pickedSel = signal('');
  arenaUrl = 'https://app.grayswan.ai/arena/challenge/ipi-black-2026';
  urlDraft = '';            // editable address bar for the active tab
  urlFocused = false;       // don't overwrite the box while the operator is typing in it

  private unsubscribeTabs?: () => void;
  private unsubscribeDocked?: () => void;
  private resizeObserver?: ResizeObserver;
  private readonly onViewportChange = () => this.reportBounds();

  async ngAfterViewInit() {
    if (!this.available) return;
    try { this.arenaUrl = (await this.api.settings()).arenaUrl || this.arenaUrl; } catch { /* backend down */ }
    try { this.docked.set((await this.arena.state()).docked); } catch { /* not electron */ }
    this.dockedChange.emit(this.docked());
    this.tabs.set(await this.arena.list());
    this.urlDraft = this.activeUrl();
    this.unsubscribeTabs = this.arena.onChanged(tabs => { this.tabs.set(tabs); if (!this.urlFocused) this.urlDraft = this.activeUrl(); });
    this.unsubscribeDocked = this.arena.onDocked(s => { this.docked.set(s.docked); this.dockedChange.emit(s.docked); this.syncView(); });
    window.addEventListener('resize', this.onViewportChange);
    window.addEventListener('scroll', this.onViewportChange, true);
    this.syncView();
  }
  ngOnDestroy() {
    this.unsubscribeTabs?.();
    this.unsubscribeDocked?.();
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onViewportChange);
    window.removeEventListener('scroll', this.onViewportChange, true);
    this.arena.setVisible(false);
  }

  // Glue the native view to the #host box when docked; hide it when detached.
  private syncView() {
    const host = this.hostRef?.nativeElement;
    this.resizeObserver?.disconnect();
    if (this.docked() && host) {
      this.resizeObserver = new ResizeObserver(() => this.reportBounds());
      this.resizeObserver.observe(host);
      this.reportBounds();
      this.arena.setVisible(true);
    } else {
      this.arena.setVisible(false);
    }
  }
  private reportBounds() {
    const host = this.hostRef?.nativeElement;
    if (!this.docked() || !host) return;
    const r = host.getBoundingClientRect();
    this.arena.setBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }

  async newTab() { await this.arena.create(this.arenaUrl); this.tabs.set(await this.arena.list()); }
  async select(id: string) { this.tabs.set(await this.arena.select(id)); }
  async close(id: string) { this.tabs.set(await this.arena.close(id)); }
  async detach() { this.docked.set((await this.arena.detach()).docked); this.dockedChange.emit(this.docked()); this.syncView(); }
  async dock() { this.docked.set((await this.arena.dock()).docked); this.dockedChange.emit(this.docked()); this.syncView(); }
  async pick() { const r = await this.arena.pick(); if (r.selector) { this.pickedSel.set(r.selector); this.picked.emit(r.selector); } }
  // Operator address-bar navigation — any web URL (login flow etc.). Automation stays arena-only server-side.
  async go() {
    const url = this.normalizeUrl(this.urlDraft.trim());
    if (!url) return;
    const active = this.tabs().find(t => t.active) ?? this.tabs()[0];
    if (!active) return;
    try { await this.arena.navigate(active.id, url); this.tabs.set(await this.arena.list()); }
    catch { /* invalid or blocked address — leave the box as typed */ }
  }
  private normalizeUrl(v: string): string { return v ? (/^https?:\/\//i.test(v) ? v : 'https://' + v) : ''; }
  short(s: string) { return s.length > 16 ? s.slice(0, 16) + '…' : s; }
}
