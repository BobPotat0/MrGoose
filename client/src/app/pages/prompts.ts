import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { PromptDto, FolderDto, EncodingTransform } from '../models';

type Row = { kind: 'folder' | 'prompt'; id: number; name: string; depth: number; verdict?: string; pinned?: boolean };

@Component({
  selector: 'mg-prompts',
  imports: [FormsModule],
  template: `
    <section class="page fillpage" style="max-width:none">
      <header class="page-head">
        <span class="label-mono">Prompt Library</span>
        <h1>Prompt Library</h1>
      </header>

      <div class="card" style="margin:0 0 12px">
        <div class="row">
          <input class="input" style="max-width:200px" [(ngModel)]="newName" placeholder="new folder / prompt name" (keydown.enter)="newPrompt()" />
          <button class="btn" (click)="newFolder()" [disabled]="!newName.trim()">+ folder</button>
          <button class="btn" (click)="newPrompt()" [disabled]="!newName.trim()">+ prompt</button>
          <input class="input grow" [(ngModel)]="search" placeholder="search prompts…" />
          <button class="btn" (click)="export()">export</button>
          <label class="btn">import<input type="file" accept=".json" hidden (change)="import($event)" /></label>
        </div>
        <!-- clipboard / item action bar -->
        <div class="row" style="margin-top:8px;gap:6px">
          <span class="muted" style="font-size:11px">selected: {{ selLabel() }}</span>
          <span class="grow"></span>
          <button class="btn" (click)="copy()" [disabled]="!selected()">⧉ copy</button>
          <button class="btn" (click)="cut()" [disabled]="!selected()">✂ cut</button>
          <button class="btn" (click)="paste()" [disabled]="!clipboard()">📋 paste here{{ clipLabel() }}</button>
          <button class="btn" (click)="duplicate()" [disabled]="!selected()">⎘ duplicate</button>
          <button class="btn" (click)="collapseAll()">▸ collapse all</button>
        </div>
      </div>

      <div class="workspace">
        <!-- tree -->
        <div class="pane scroll card" style="flex:0 0 300px;margin:0">
          <span class="label-mono">tree</span>
          @for (r of rows(); track r.kind + '-' + r.id) {
            <div class="row" [style.padding-left.px]="8 + r.depth*14" style="padding-top:4px;padding-bottom:4px;cursor:pointer"
                 [style.background]="isSelectedRow(r) ? 'var(--surface-3)' : ''" [style.opacity]="isCut(r) ? 0.5 : 1"
                 (click)="click(r)" (dblclick)="beginRename(r)">
              @if (renaming()?.kind === r.kind && renaming()?.id === r.id) {
                <input class="input" style="height:24px;font-size:12.5px" [(ngModel)]="renameText" (click)="$event.stopPropagation()"
                       (keydown.enter)="commitRename()" (keydown.escape)="renaming.set(null)" (blur)="commitRename()" autofocus />
              } @else if (r.kind === 'folder') {
                <span style="color:var(--amber)">{{ expanded().has(r.id) ? '▾' : '▸' }} 🗀 {{ r.name }}</span>
                <span class="grow"></span>
                <span style="cursor:pointer" [style.opacity]="r.pinned ? 1 : 0.3" (click)="togglePin(r.id); $event.stopPropagation()" title="pin (auto-expand)">★</span>
              } @else {
                <span class="mono" style="font-size:12.5px">{{ r.name }}</span>
                @if (r.verdict === 'break') { <span class="chip lime" style="margin-left:6px">brk</span> }
              }
            </div>
          }
          @if (!rows().length) { <p class="muted" style="font-size:12px;margin-top:8px">{{ search ? 'no match' : 'empty — add a folder or prompt' }}</p> }
        </div>

        <!-- detail -->
        <div class="pane scroll" style="flex:1">
          @if (selected(); as p) {
            <div class="card">
              <div class="grid2">
                <div class="field"><label>title</label><input class="input" [(ngModel)]="p.title" /></div>
                <div class="field"><label>folder</label><select class="input" [(ngModel)]="p.folderId"><option [ngValue]="null">— root —</option>@for (f of folders(); track f.id) { <option [ngValue]="f.id">{{ f.name }}</option> }</select></div>
                <div class="field"><label>tags</label><input class="input" [(ngModel)]="p.tags" /></div>
                <div class="field"><label>verdict</label><select class="input" [(ngModel)]="p.verdict"><option>untested</option><option>break</option><option>wall</option><option>partial</option></select></div>
              </div>
              <div class="field" style="margin-top:10px">
                <div class="row spread"><label>payload</label>
                  <span class="row" style="gap:4px">
                    <button class="btn" style="height:22px;padding:2px 8px" (click)="undo()" [disabled]="!canUndo()" title="undo">↶</button>
                    <button class="btn" style="height:22px;padding:2px 8px" (click)="redo()" [disabled]="!canRedo()" title="redo">↷</button>
                  </span>
                </div>
                <textarea #bodyArea class="textarea" style="min-height:200px" [(ngModel)]="p.body" (focus)="snapshot()" (blur)="snapshot()" (select)="onSel()" (keyup)="onSel()" (mouseup)="onSel()"></textarea>
                <span class="muted" style="font-size:11px;margin-top:4px">Tip: select part of the payload, then use AI-edit or encode to change only that part.</span>
              </div>
              <div class="row" style="margin-top:8px"><button class="btn primary" (click)="save()">save</button><button class="btn danger" (click)="del()">delete</button></div>
            </div>

            <!-- multi-shot follow-up turns -->
            <div class="card alt">
              <div class="row spread"><span class="label-mono">multi-shot follow-up turns ({{ followups().length }})</span><button class="btn" (click)="addFollowup()">+ turn</button></div>
              @for (f of followups(); track $index) {
                <div class="row" style="margin-top:8px;align-items:flex-start">
                  <span class="mono muted" style="padding-top:8px;min-width:22px">{{ $index + 1 }}.</span>
                  <textarea class="textarea grow" style="min-height:60px" [ngModel]="f" (ngModelChange)="setFollowup($index, $event)"></textarea>
                  <button class="btn danger" (click)="removeFollowup($index)">×</button>
                </div>
              }
              @if (!followups().length) { <p class="muted" style="font-size:12px;margin-top:6px">No follow-ups — add turns to send after the opener in a multi-turn attack.</p> }
            </div>

            <div class="card alt">
              <span class="label-mono">AI editor</span>
              <div class="row" style="margin-top:8px"><input class="input grow" [(ngModel)]="aiInstruction" placeholder="instruction — e.g. shorten, apply the sandbox reframe, make it read as on-task…" /><button class="btn" (click)="aiEdit()" [disabled]="aiBusy()">{{ aiBusy() ? 'editing…' : (hasSelection() ? 'AI edit selection' : 'AI edit') }}</button></div>
            </div>

            <!-- encoder: collapsed by default; categorized multi-select chain + [ENC] marked spans -->
            <div class="card alt">
              <div class="row spread" style="cursor:pointer" (click)="showEncoder.set(!showEncoder())">
                <span class="label-mono">{{ showEncoder() ? '▾' : '▸' }} encoder{{ encKeys().length ? ' (' + encKeys().length + ')' : '' }}</span>
                <span class="muted" style="font-size:11px">{{ showEncoder() ? 'click to collapse' : 'click to expand' }}</span>
              </div>
              @if (showEncoder()) {
                <div class="row" style="margin-top:8px"><label class="row" style="gap:6px;font-size:12px"><input type="checkbox" [(ngModel)]="encMarked" /> only encode [ENC]…[/ENC] spans</label></div>
                @for (cat of encCategories(); track cat) {
                  <div style="margin-top:8px">
                    <span class="muted mono" style="font-size:10.5px">{{ cat }}</span>
                    <div class="row" style="flex-wrap:wrap;gap:5px;margin-top:4px">
                      @for (t of encByCat(cat); track t.key) {
                        <span class="chip" style="cursor:pointer" [class.lime]="encKeys().includes(t.key)" (click)="toggleEnc(t.key)" [title]="t.key">{{ t.name }}</span>
                      }
                    </div>
                  </div>
                }
                <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">
                  <span class="muted" style="font-size:11px">chain: {{ encKeys().length ? encKeys().join(' → ') : '(none)' }}</span>
                  <span class="grow"></span>
                  <button class="btn" (click)="wrapEnc()" title="wrap the selected text (or whole payload) in [ENC]…[/ENC]">wrap [ENC]</button>
                  <button class="btn" (click)="clearEnc()" [disabled]="!encKeys().length">clear</button>
                  <button class="btn primary" (click)="encode()" [disabled]="!encKeys().length">{{ hasSelection() ? 'encode selection' : 'encode payload' }}</button>
                </div>
                <span class="muted" style="font-size:11px">replaces the payload above (save to keep)</span>
              }
            </div>
          } @else { <p class="dim">Select a prompt from the tree.</p> }
        </div>
      </div>
    </section>
  `,
})
export class PromptsPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  readonly folders = signal<FolderDto[]>([]);
  readonly prompts = signal<PromptDto[]>([]);
  readonly expanded = signal<Set<number>>(new Set());
  readonly pinned = signal<Set<number>>(new Set());
  readonly selected = signal<PromptDto | null>(null);
  readonly selFolderId = signal<number | null>(null);
  readonly catalog = signal<EncodingTransform[]>([]);
  readonly encKeys = signal<string[]>([]);
  readonly showEncoder = signal(false);
  readonly aiBusy = signal(false);
  readonly renaming = signal<{ kind: 'folder' | 'prompt'; id: number } | null>(null);
  readonly clipboard = signal<{ kind: 'folder' | 'prompt'; id: number; cut: boolean } | null>(null);
  readonly selRange = signal<{ s: number; e: number } | null>(null);
  @ViewChild('bodyArea') bodyArea?: ElementRef<HTMLTextAreaElement>;
  newName = ''; aiInstruction = ''; encMarked = false; search = ''; renameText = '';

  // per-prompt undo/redo history of the body
  private history = new Map<number, { stack: string[]; ptr: number }>();

  constructor() { this.load(); this.restorePins(); }
  async load() {
    this.folders.set(await this.api.folders());
    this.prompts.set(await this.api.prompts());
    this.catalog.set(await this.api.encodeCatalog());
  }

  // ── tree ──
  rows(): Row[] {
    const q = this.search.trim().toLowerCase();
    const match = (p: PromptDto) => !q || `${p.title} ${p.tags} ${p.body}`.toLowerCase().includes(q);
    const out: Row[] = [];
    const walk = (pid: number | null, depth: number) => {
      for (const f of this.folders().filter(x => x.parentId === pid)) {
        const kids = this.prompts().filter(x => x.folderId === f.id);
        if (q && !kids.some(match) && !this.folders().some(c => c.parentId === f.id)) continue;
        out.push({ kind: 'folder', id: f.id, name: f.name, depth, pinned: this.pinned().has(f.id) });
        if (this.expanded().has(f.id) || q) {
          walk(f.id, depth + 1);
          for (const p of kids.filter(match)) out.push({ kind: 'prompt', id: p.id, name: p.title, depth: depth + 1, verdict: p.verdict });
        }
      }
    };
    walk(null, 0);
    for (const p of this.prompts().filter(x => x.folderId == null).filter(match)) out.push({ kind: 'prompt', id: p.id, name: p.title, depth: 0, verdict: p.verdict });
    return out;
  }
  isSelectedRow(r: Row) { return r.kind === 'prompt' && this.selected()?.id === r.id || r.kind === 'folder' && this.selected() == null && this.selFolderId() === r.id; }
  isCut(r: Row) { const c = this.clipboard(); return !!c && c.cut && c.kind === r.kind && c.id === r.id; }
  click(r: Row) {
    if (r.kind === 'folder') {
      this.selected.set(null); this.selFolderId.set(r.id);
      const s = new Set(this.expanded()); s.has(r.id) ? s.delete(r.id) : s.add(r.id); this.expanded.set(s);
    } else {
      this.selFolderId.set(null);
      this.selected.set(this.prompts().find(p => p.id === r.id) ?? null);
    }
  }

  // ── create / save / delete ──
  private targetFolder(): number | null { return this.selected()?.folderId ?? this.selFolderId(); }
  async newFolder() { await this.api.addFolder(this.newName.trim(), this.targetFolder()); this.newName = ''; await this.load(); this.toast.ok('folder added'); }
  async newPrompt() { if (!this.newName.trim()) return; const p = await this.api.addPrompt({ title: this.newName.trim(), body: '', folderId: this.targetFolder(), source: 'manual' }); this.newName = ''; await this.load(); this.selectPrompt(p); }
  async save() { const p = this.selected()!; await this.api.updatePrompt(p.id, p); await this.load(); this.selectPrompt(p); this.toast.ok('saved'); }
  async del() { const p = this.selected()!; await this.api.deletePrompt(p.id); this.selected.set(null); await this.load(); this.toast.ok('deleted'); }

  private selectPrompt(p: PromptDto) { this.selected.set(this.prompts().find(x => x.id === p.id) ?? p); }

  // ── inline rename ──
  beginRename(r: Row) { this.renaming.set({ kind: r.kind, id: r.id }); this.renameText = r.name; }
  async commitRename() {
    const r = this.renaming(); if (!r) return; const name = this.renameText.trim(); this.renaming.set(null);
    if (!name) return;
    if (r.kind === 'folder') { const f = this.folders().find(x => x.id === r.id)!; await this.api.renameFolder(r.id, name, f.parentId); }
    else { const p = this.prompts().find(x => x.id === r.id)!; await this.api.updatePrompt(r.id, { ...p, title: name }); }
    await this.load(); this.toast.ok('renamed');
  }

  // ── clipboard (cut/copy/paste/duplicate) ──
  selLabel() { const p = this.selected(); if (p) return `prompt "${p.title}"`; const fid = this.selFolderId(); const f = fid != null ? this.folders().find(x => x.id === fid) : null; return f ? `folder "${f.name}"` : '—'; }
  clipLabel() { const c = this.clipboard(); return c ? ` (${c.cut ? 'move' : 'copy'})` : ''; }
  copy() { const c = this.currentItem(); if (c) { this.clipboard.set({ ...c, cut: false }); this.toast.ok('copied'); } }
  cut() { const c = this.currentItem(); if (c) { this.clipboard.set({ ...c, cut: true }); this.toast.ok('cut — paste into a folder'); } }
  private currentItem(): { kind: 'folder' | 'prompt'; id: number } | null {
    const p = this.selected(); if (p) return { kind: 'prompt', id: p.id };
    const fid = this.selFolderId(); return fid != null ? { kind: 'folder', id: fid } : null;
  }
  async paste() {
    const c = this.clipboard(); if (!c) return;
    const dest = this.selFolderId();   // paste target = selected folder (null = root)
    if (c.kind === 'prompt') {
      const src = this.prompts().find(x => x.id === c.id); if (!src) return;
      if (c.cut) await this.api.updatePrompt(c.id, { ...src, folderId: dest });
      else { const copy = await this.api.duplicatePrompt(c.id); await this.api.updatePrompt(copy.id, { ...copy, folderId: dest }); }
    } else {
      const src = this.folders().find(x => x.id === c.id); if (!src || !c.cut) { this.toast.err('only cut folders can be moved'); return; }
      if (dest === c.id) return;
      await this.api.renameFolder(c.id, src.name, dest);
    }
    if (c.cut) this.clipboard.set(null);
    await this.load(); this.toast.ok('pasted');
  }
  async duplicate() { const p = this.selected(); if (!p) return; const copy = await this.api.duplicatePrompt(p.id); await this.load(); this.selectPrompt(copy); this.toast.ok('duplicated'); }

  // ── pins + expand ──
  collapseAll() { this.expanded.set(new Set([...this.pinned()])); }
  togglePin(id: number) {
    const s = new Set(this.pinned()); s.has(id) ? s.delete(id) : s.add(id); this.pinned.set(s);
    const e = new Set(this.expanded()); if (s.has(id)) e.add(id); this.expanded.set(e);
    try { localStorage.setItem('mg.pins', JSON.stringify([...s])); } catch { /* ignore */ }
  }
  private restorePins() {
    try { const raw = localStorage.getItem('mg.pins'); if (raw) { const ids: number[] = JSON.parse(raw); this.pinned.set(new Set(ids)); this.expanded.set(new Set(ids)); } } catch { /* ignore */ }
  }

  // ── undo / redo (body history) ──
  private hist() { const p = this.selected(); if (!p) return null; let h = this.history.get(p.id); if (!h) { h = { stack: [p.body], ptr: 0 }; this.history.set(p.id, h); } return h; }
  snapshot() { const p = this.selected(); const h = this.hist(); if (!p || !h) return; if (h.stack[h.ptr] === p.body) return; h.stack = h.stack.slice(0, h.ptr + 1); h.stack.push(p.body); if (h.stack.length > 100) h.stack.shift(); h.ptr = h.stack.length - 1; }
  canUndo() { const h = this.history.get(this.selected()?.id ?? -1); return !!h && h.ptr > 0; }
  canRedo() { const h = this.history.get(this.selected()?.id ?? -1); return !!h && h.ptr < h.stack.length - 1; }
  undo() { const p = this.selected(); const h = this.hist(); if (!p || !h || h.ptr <= 0) return; this.snapshot(); h.ptr--; p.body = h.stack[h.ptr]; this.selected.set({ ...p }); }
  redo() { const p = this.selected(); const h = this.history.get(p?.id ?? -1); if (!p || !h || h.ptr >= h.stack.length - 1) return; h.ptr++; p.body = h.stack[h.ptr]; this.selected.set({ ...p }); }

  // ── multi-shot follow-ups ──
  followups(): string[] { const p = this.selected(); if (!p) return []; try { return JSON.parse(p.followUpsJson || '[]'); } catch { return []; } }
  private setFollowups(arr: string[]) { const p = this.selected(); if (!p) return; p.followUpsJson = JSON.stringify(arr); this.selected.set({ ...p }); }
  addFollowup() { this.setFollowups([...this.followups(), '']); }
  setFollowup(i: number, v: string) { const a = this.followups(); a[i] = v; this.setFollowups(a); }
  removeFollowup(i: number) { const a = this.followups(); a.splice(i, 1); this.setFollowups(a); }

  // ── selection (encode / AI-rewrite only part of the payload) ──
  onSel() { const el = this.bodyArea?.nativeElement; if (!el) return; const s = el.selectionStart ?? 0, e = el.selectionEnd ?? 0; this.selRange.set(e > s ? { s, e } : null); }
  hasSelection() { return !!this.selRange(); }
  private liveSel(): { s: number; e: number } | null { const el = this.bodyArea?.nativeElement; if (el) { const s = el.selectionStart ?? 0, e = el.selectionEnd ?? 0; if (e > s) return { s, e }; } return this.selRange(); }

  // ── AI edit + encoder ──
  async aiEdit() {
    const p = this.selected()!; if (!this.aiInstruction.trim()) return;
    const sel = this.liveSel();
    const target = sel ? p.body.slice(sel.s, sel.e) : p.body;
    this.aiBusy.set(true);
    const r = await this.api.aiEdit(target, this.aiInstruction.trim());
    this.aiBusy.set(false);
    if (r.error) { this.toast.err(r.error); return; }
    this.snapshot();
    p.body = sel ? p.body.slice(0, sel.s) + r.result + p.body.slice(sel.e) : r.result;
    this.selected.set({ ...p }); this.selRange.set(null); this.snapshot();
    this.toast.ok(`AI edited ${sel ? 'selection ' : ''}— review & save`);
  }
  encCategories(): string[] { return [...new Set(this.catalog().map(t => t.category))]; }
  encByCat(cat: string): EncodingTransform[] { return this.catalog().filter(t => t.category === cat); }
  toggleEnc(key: string) { const a = [...this.encKeys()]; const i = a.indexOf(key); i >= 0 ? a.splice(i, 1) : a.push(key); this.encKeys.set(a); }
  clearEnc() { this.encKeys.set([]); }
  wrapEnc() {
    const p = this.selected(); if (!p) return; this.snapshot();
    const sel = this.liveSel();
    p.body = sel ? p.body.slice(0, sel.s) + '[ENC]' + p.body.slice(sel.s, sel.e) + '[/ENC]' + p.body.slice(sel.e) : `[ENC]${p.body}[/ENC]`;
    this.selected.set({ ...p }); this.encMarked = true; this.selRange.set(null);
  }
  async encode() {
    const p = this.selected()!;
    const sel = this.liveSel();
    const target = sel ? p.body.slice(sel.s, sel.e) : p.body;
    const r = await this.api.encodeChain(this.encKeys(), target, this.encMarked);
    this.snapshot();
    p.body = sel ? p.body.slice(0, sel.s) + r.result + p.body.slice(sel.e) : r.result;
    this.selected.set({ ...p }); this.selRange.set(null); this.snapshot();
    this.toast.ok(`encoded ${sel ? 'selection ' : ''}(${this.encKeys().join(' → ')}) — save to keep`);
  }

  // ── export / import ──
  async export() {
    const data = await this.api.exportPrompts();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mrgoose-prompts.json'; a.click();
    URL.revokeObjectURL(a.href); this.toast.ok('exported');
  }
  async import(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
    try { const data = JSON.parse(await file.text()); const r = await this.api.importPrompts(data); await this.load(); this.toast.ok(`imported ${r.prompts} prompts, ${r.folders} folders`); }
    catch { this.toast.err('invalid JSON'); }
  }
}
