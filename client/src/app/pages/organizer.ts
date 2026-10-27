import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../backend.service';
import { ArenaService } from '../arena.service';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { OrganizerChatStore } from '../organizer-chat.store';
import { OrganizerFilesComponent } from '../organizer-files.component';
import { InspectorComponent } from '../inspector.component';
import { InspectorStore } from '../inspector.store';
import { KnowledgeNote, OrganizerDoc, OrganizerFileInfo } from '../models';

@Component({
  selector: 'mg-assistant',
  imports: [FormsModule, OrganizerFilesComponent, InspectorComponent],
  template: `
    <section class="page agent-page">
      <header class="page-head agent-head">
        <div class="agent-heading">
          <span class="label-mono">Mr Goose Organizer</span>
          @if (renaming()) {
            <form class="row title-form" (submit)="saveTitle($event)">
              <input class="input" name="sessionTitle" [(ngModel)]="titleDraft" aria-label="Session title" maxlength="80" />
              <button class="btn" type="submit">Save</button><button class="btn ghost" type="button" (click)="renaming.set(false)">Cancel</button>
            </form>
          } @else {
            <div class="row title-row"><h1>{{ chat.currentTitle() }}</h1><button class="btn ghost title-rename" type="button" (click)="beginRename()" [disabled]="chat.streaming()">Rename</button></div>
          }
        </div>
        <div class="row agent-actions">
          <div class="row" style="gap: 4px; margin-right: 6px" role="tablist" aria-label="Organizer mode">
            <button class="btn" [class.primary]="orgMode() === 'direct'" (click)="setOrgMode('direct')">Direct</button>
            <button class="btn" [class.primary]="orgMode() === 'mcp'" (click)="setOrgMode('mcp')">MCP</button>
          </div>
          <button class="btn" type="button" (click)="showInstructions.set(!showInstructions())" [attr.aria-expanded]="showInstructions()" aria-controls="agent-instructions">Instructions</button>
          <button class="btn" type="button" (click)="showFiles.set(!showFiles())" [attr.aria-expanded]="showFiles()" aria-controls="agent-session-files" [disabled]="chat.uploading()">Files</button>
          <button class="btn ghost" type="button" (click)="deleteChat()" [disabled]="chat.streaming() || chat.uploading() || !chat.sessions().length">Delete chat</button>
        </div>
      </header>

      @if (showInstructions()) {
      <section id="agent-instructions" class="instructions-panel" aria-label="Agent instructions">
        <div class="row spread instructions-head"><span class="label-mono">Instructions</span><button class="btn ghost" type="button" (click)="showInstructions.set(false)">Close</button></div>
      <!-- system prompt (view + edit) -->
      <div class="card alt">
        <div class="row spread" style="cursor:pointer" (click)="showSys.set(!showSys())">
          <span class="label-mono">{{ showSys() ? '▾' : '▸' }} system prompt @if (sysCustom()) { <span class="chip" style="margin-left:6px">custom</span> }</span>
          <span class="muted" style="font-size:11px">what drives Mr Goose — editable</span>
        </div>
        @if (showSys()) {
          <textarea class="textarea" style="margin-top:8px;min-height:180px" [(ngModel)]="sysPrompt"></textarea>
          <div class="row" style="margin-top:8px"><button class="btn primary" (click)="saveSys()">save</button><button class="btn" (click)="resetSys()">reset to default</button>
            <span class="grow"></span><span class="muted" style="font-size:11px">knowledge-base notes are appended automatically</span></div>
        }
      </div>

      <!-- knowledge base: .md program docs (folder) + operator notes -->
      <div class="card alt">
        <div class="row spread" style="cursor:pointer" (click)="showKb.set(!showKb())">
          <span class="label-mono">{{ showKb() ? '▾' : '▸' }} knowledge base — {{ docs().length }} docs</span>
          <span class="muted" style="font-size:11px">knowledge/*.md on how Mr Goose works — loaded into the agent</span>
        </div>
        @if (showKb()) {
          @for (d of docs(); track d.name) {
            <div class="card" style="margin-top:8px">
              <div class="row spread" style="cursor:pointer" (click)="openDoc.set(openDoc()===d.name ? '' : d.name)">
                <span class="mono" style="font-size:12.5px;color:var(--lime)">{{ openDoc()===d.name ? '▾' : '▸' }} {{ d.name }}@if (d.isCustom) { <span class="chip" style="margin-left:6px">custom</span> }</span>
                <span class="muted" style="font-size:11px">{{ d.content.length }} chars</span>
              </div>
              @if (openDoc()===d.name) {
                <textarea class="textarea" style="min-height:220px;margin-top:6px;font-size:12px" [(ngModel)]="d.content"></textarea>
                <div class="row" style="margin-top:6px"><button class="btn primary" (click)="saveDoc(d)">save</button>@if (d.isCustom) { <button class="btn" (click)="resetDoc(d)">reset this doc</button> }</div>
              }
            </div>
          }
          @if (!docs().length) { <p class="muted" style="font-size:12px;margin-top:6px">No docs found — they live in <span class="mono">backend/knowledge/*.md</span>.</p> }
          <div class="row" style="margin-top:10px"><button class="btn" (click)="resetAllDocs()">reset all to default</button><span class="muted" style="font-size:11px;margin-left:8px">edit a doc above & save (applies immediately); reset restores the shipped default</span></div>

          <div class="row spread" style="margin-top:14px"><span class="label-mono">operator notes ({{ knowledge().length }})</span><span class="muted" style="font-size:11px">extra facts you add; also appended</span></div>
          <div class="row" style="margin-top:6px"><input class="input" style="max-width:220px" [(ngModel)]="kbTitle" placeholder="note title" /><input class="input grow" [(ngModel)]="kbContent" placeholder="fact / content" /><button class="btn primary" (click)="addKb()" [disabled]="!kbTitle.trim() || !kbContent.trim()">+ note</button></div>
          @for (n of knowledge(); track n.id) {
            <div class="card" style="margin-top:8px"><div class="row spread"><strong style="font-size:13px">{{ n.title }}</strong><button class="btn danger" style="height:22px;padding:2px 8px" (click)="delKb(n)">×</button></div><p class="dim" style="margin:4px 0 0;font-size:12.5px;white-space:pre-wrap">{{ n.content }}</p></div>
          }
        }
      </div>

      </section>
      }
      @if (chat.historyError()) { <p class="history-error" role="status">{{ chat.historyError() }}</p> }

      @if (orgMode() === 'mcp') {
        <div class="mcp-bar">Organizer runs via MCP — your external model drives it via <span class="mono">organizer_run</span> + <span class="mono">open_in_view</span>. Files &amp; Inspector below are live: drop a file and it reads it with <span class="mono">list_files</span>/<span class="mono">read_file</span>. Launch/Submit stays manual.</div>
      }
      <div class="agent-layout" [class.with-files]="showFiles() || orgMode() === 'mcp'" [class.mcp]="orgMode() === 'mcp'">
      @if (orgMode() === 'direct') {
      <div class="agent-chat-column">
      <div #thread class="card agent-thread">
        @for (v of chat.view(); track $index) {
          @if (v.type==='file' && v.file) {
            <button class="file-card" type="button" (click)="openFile(v.file)"><span class="mono file-card-icon">▤</span><span><strong>{{ v.file.name }}</strong><small>{{ v.file.source === 'upload' ? 'Uploaded by you' : 'Created by Mr Goose' }} · Open preview →</small></span></button>
          }
          @else if (v.type==='techniques') {
            <section class="technique-snapshot" aria-label="Technique library snapshot">
              <div class="row spread"><strong>Technique library</strong><span class="chip">{{ v.techniques?.length || 0 }} techniques</span></div>
              <p class="muted" style="font-size:11px;margin:6px 0 12px">Snapshot from when the agent called show_techniques.</p>
              @if (v.techniques?.length) {
                <div style="overflow-x:auto">
                  <table class="technique-table">
                    <thead><tr><th scope="col">Technique</th><th scope="col">Description</th><th scope="col">When it works / example</th></tr></thead>
                    <tbody>
                      @for (t of v.techniques; track t.id) {
                        <tr class="tech-row" (click)="openTechniqueInInspector(t.id)" title="Open in the inspector" style="cursor:pointer"><td><strong>{{ t.title }}</strong><div class="muted" style="margin-top:6px">{{ t.tags }} · {{ t.builtin ? 'built-in' : 'custom' }}</div></td>
                          <td>{{ t.summary || '—' }}</td>
                          <td><p>{{ t.whenItWorks || 'No applicability notes.' }}</p>
                            @if (t.example) { <details style="margin-top:8px" (click)="$event.stopPropagation()"><summary>Example</summary><pre class="mono">{{ t.example }}</pre></details> }
                          </td></tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else { <p class="dim">No techniques in the library yet.</p> }
            </section>
          }
          @else if (v.type==='tool') { <div class="mono" style="font-size:11px;color:var(--amber);margin:4px 0">⚙ {{ v.text }}</div> }
          @else if (v.type==='user') { <div style="margin-bottom:12px"><span class="label-mono" style="color:var(--lime)">you</span><pre class="mono" style="white-space:pre-wrap;font-size:13px;line-height:1.5;margin-top:4px;color:var(--text)">{{ v.text }}</pre></div> }
          @else {
            <div style="margin-bottom:12px">
              <div class="label-mono" style="color:var(--text-mute)">mr goose</div>
              @if (v.reasoning) {
                <div class="label-mono" style="color:var(--amber);cursor:pointer;margin-top:4px" (click)="chat.toggleReasoning($index)">{{ v.reasoningOpen ? '▾' : '▸' }} reasoning</div>
                @if (v.reasoningOpen) { <pre class="mono dim" style="white-space:pre-wrap;font-size:11.5px;line-height:1.45;border-left:2px solid var(--surface-3);padding-left:8px;margin:4px 0 8px">{{ v.reasoning }}</pre> }
              }
              <pre class="mono" style="white-space:pre-wrap;font-size:13px;line-height:1.5;margin-top:4px;color:var(--text)">{{ v.text }}</pre>
            </div>
          }
        }
        @if (!chat.view().length) { <p class="dim">e.g. “make a folder ‘WB2 wins’ and move my break prompts into it”, “add a technique for the sandbox reframe”, “set a model × scenario verdict to break”, or “open the arena and fill the chat box with …”.</p> }
      </div>

      <div class="composer-dock">
        <div class="agent-composer">
          <textarea #composer [(ngModel)]="input" (input)="resizeComposer($event)" (keydown)="composerKeydown($event)" rows="2" aria-label="Message Mr Goose" placeholder="Ask Mr Goose…"></textarea>
          <div class="composer-footer">
            <div class="composer-context"><span class="composer-mode">Agent</span><span class="composer-model" [title]="modelLabel()">{{ modelLabel() }}</span></div>
            <button class="composer-send" type="button" (click)="send()" [disabled]="chat.streaming() || chat.uploading() || !input.trim()" aria-label="Send message"><span aria-hidden="true">↑</span></button>
          </div>
        </div>
        <div class="composer-hints"><span>Enter send · Shift+Enter newline</span><span role="status">{{ chat.streaming() ? 'Working…' : 'Fill only · you submit' }}</span></div>
      </div>
      </div>
      }
      @defer (when showFiles() || orgMode() === 'mcp') {
        @if (showFiles() || orgMode() === 'mcp') {
          <div class="agent-side">
            <mg-agent-files id="agent-session-files" [sessionId]="chat.activeId()" [revision]="chat.filesRevision()" [hidePreview]="true" [openFileId]="fileFocus()?.sessionId === chat.activeId() ? fileFocus()?.id || '' : ''" (fileUploaded)="chat.recordFile($event)" (uploadingChange)="uploadState($event)" (fileSelected)="openInInspector($event)" />
            <mg-inspector />
          </div>
        }
      }
      </div>
    </section>
  `,
  styles: [`
    .technique-snapshot { margin: 12px 0 18px; border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 12px; }
    .technique-table { width: 100%; border-collapse: collapse; min-width: 600px; font-size: 12px; line-height: 1.5; }
    .technique-table th, .technique-table td { padding: 10px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--border); white-space: pre-wrap; overflow-wrap: anywhere; }
    .technique-table th { color: var(--text-dim); font-size: 11px; }
    .technique-table td:first-child { width: 24%; }
    .technique-table td:nth-child(2) { width: 34%; }
    .technique-table pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 11px; margin: 8px 0 0; }
    .technique-table summary { cursor: pointer; color: var(--lime); }
    :host { display: block; height: 100%; }
    .agent-page { width: 100%; max-width: none; min-width: 0; height: 100%; overflow: hidden; display: flex; flex-direction: column; }
    .agent-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; flex-wrap: wrap; flex-shrink: 0; }
    .agent-heading { min-width: 0; flex: 1; }
    .title-row { gap: 10px; margin-top: 6px; }
    .title-row h1 { overflow-wrap: anywhere; }
    .title-rename { color: var(--text-dim); font-size: 11px; padding: 4px 7px; }
    .title-form { margin-top: 9px; }
    .title-form .input { flex: 1 1 180px; }
    .agent-actions { padding-top: 3px; }
    .instructions-panel { padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); margin-bottom: 18px; flex-shrink: 0; max-height: 46%; overflow: auto; }
    .instructions-head { margin: 0 2px 10px; }
    .instructions-panel > .card:last-child { margin-bottom: 0; }
    .history-error { color: var(--amber); font-size: 12px; margin-bottom: 12px; }
    .agent-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; flex: 1; min-height: 0; overflow: hidden; }
    .agent-layout.with-files { grid-template-columns: minmax(0, 1fr) minmax(300px, 34%); }
    .agent-chat-column { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    .agent-thread { flex: 1; min-height: 0; overflow-y: auto; }
    .file-card { display: flex; align-items: center; gap: 12px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 12px 14px; margin: 10px 0 16px; text-align: left; cursor: pointer; max-width: 100%; }
    .file-card:hover { border-color: var(--lime); }
    .file-card strong { display: block; font-size: 12px; overflow-wrap: anywhere; }
    .file-card small { display: block; color: var(--text-dim); font-size: 11px; margin-top: 5px; }
    .file-card-icon { color: var(--lime); font-size: 22px; }
    @media (max-width: 1100px) { .agent-layout.with-files { grid-template-columns: minmax(0, 1fr); } .agent-chat-column { min-height: 460px; } }
    .agent-layout.mcp { grid-template-columns: minmax(0, 1fr) !important; }
    .mcp-bar { flex-shrink: 0; border: 1px solid var(--lime); border-radius: 8px; background: var(--surface); padding: 9px 12px; margin-bottom: 14px; font-size: 12px; color: var(--text-dim); line-height: 1.5; }
    .agent-side { display: flex; flex-direction: column; gap: 16px; min-height: 0; overflow: hidden; }
    .agent-side mg-agent-files { display: block; flex: 0 1 auto; max-height: 48%; overflow: auto; }
    .agent-side mg-inspector { display: block; flex: 1 1 auto; min-height: 0; overflow: auto; }
    .composer-dock { flex-shrink: 0; padding-top: 9px; padding-bottom: 3px; }
    .agent-composer { border: 1px solid var(--border-strong); border-left: 3px solid var(--lime); border-radius: 8px; background: var(--surface-2); padding: 14px 15px 10px; }
    .agent-composer:focus-within { border-color: var(--lime); }
    .agent-composer textarea { display: block; width: 100%; min-height: 56px; max-height: 220px; resize: none; overflow-y: auto; border: 0; outline: none; padding: 0; background: transparent; color: var(--text); font: 13px/1.6 var(--mono); }
    .agent-composer textarea::placeholder { color: var(--text-mute); }
    .composer-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
    .composer-context { min-width: 0; display: flex; align-items: center; gap: 12px; font: 11px var(--mono); }
    .composer-mode { color: var(--lime); }
    .composer-model { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .composer-send { border: 1px solid var(--lime); border-radius: 5px; background: var(--lime); color: var(--bg); width: 32px; height: 30px; font: 21px var(--mono); cursor: pointer; flex-shrink: 0; }
    .composer-send:hover { background: var(--lime-soft); }
    .composer-send:disabled { opacity: .4; cursor: not-allowed; }
    .composer-hints { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 8px; color: var(--text-mute); font: 11px/1.5 var(--mono); }
    @media (max-width: 760px) { .agent-page { padding: 20px 16px; } .agent-heading { flex-basis: 100%; } .agent-actions { padding-top: 0; } }
  `],
})
export class OrganizerPage implements AfterViewInit, OnDestroy {
  backend = inject(BackendService);
  arena = inject(ArenaService);
  chat = inject(OrganizerChatStore);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  readonly inspector = inject(InspectorStore);

  input = '';
  readonly showInstructions = signal(false);
  readonly showFiles = signal(true);
  // Direct = in-app organizer chat. MCP = an external model drives the organizer; chat is hidden, Files + Inspector stay live.
  readonly orgMode = signal<'direct' | 'mcp'>((() => { try { return (localStorage.getItem('mg.orgMode') as 'direct' | 'mcp') || 'direct'; } catch { return 'direct'; } })());
  setOrgMode(m: 'direct' | 'mcp') { this.orgMode.set(m); try { localStorage.setItem('mg.orgMode', m); } catch { /* */ } if (m === 'mcp') void this.api.setOrganizerSession(this.chat.activeId()); }
  readonly fileFocus = signal<{ sessionId: string; id: string } | null>(null);
  readonly renaming = signal(false);
  readonly modelLabel = signal('Configured model');
  titleDraft = '';
  @ViewChild('composer') composer?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('thread') threadRef?: ElementRef<HTMLElement>;
  private stick = true;
  private threadObserver?: MutationObserver;

  // system prompt + knowledge base
  readonly showSys = signal(false);
  readonly showKb = signal(false);
  readonly sysCustom = signal(false);
  readonly knowledge = signal<KnowledgeNote[]>([]);
  readonly docs = signal<OrganizerDoc[]>([]);
  readonly openDoc = signal('');
  sysPrompt = ''; kbTitle = ''; kbContent = '';

  constructor() { this.loadAgentConfig(); if (this.orgMode() === 'mcp') void this.api.setOrganizerSession(this.chat.activeId()); }

  ngAfterViewInit() {
    const el = this.threadRef?.nativeElement;
    if (!el) return;
    // Stick to the bottom as the chat grows; release when the operator scrolls up, re-engage at the bottom.
    el.addEventListener('scroll', () => { this.stick = el.scrollHeight - el.scrollTop - el.clientHeight < 48; });
    this.threadObserver = new MutationObserver(() => { if (this.stick) el.scrollTop = el.scrollHeight; });
    this.threadObserver.observe(el, { childList: true, subtree: true, characterData: true });
    el.scrollTop = el.scrollHeight;
  }
  ngOnDestroy() { this.threadObserver?.disconnect(); }

  send() {
    if (this.chat.streaming() || this.chat.uploading() || !this.input.trim()) return;
    const text = this.input; this.input = '';
    if (this.composer) this.composer.nativeElement.style.height = '';
    void this.chat.send(text);
  }
  composerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing) {
      event.preventDefault(); this.send();
    }
  }
  resizeComposer(event: Event) {
    const area = event.target as HTMLTextAreaElement;
    area.style.height = 'auto'; area.style.height = Math.min(area.scrollHeight, 220) + 'px';
  }
  beginRename() { this.titleDraft = this.chat.currentTitle(); this.renaming.set(true); }
  saveTitle(event: Event) { event.preventDefault(); this.chat.renameChat(this.titleDraft); this.renaming.set(false); }
  focusFile(file: OrganizerFileInfo) { this.fileFocus.set({ sessionId: this.chat.activeId(), id: file.id }); }
  openInInspector(file: OrganizerFileInfo) { this.focusFile(file); void this.inspector.openFile(this.chat.activeId(), file.id); }
  openTechniqueInInspector(id: number) { this.showFiles.set(true); void this.inspector.openTechnique(id); }
  openFile(file: OrganizerFileInfo) { this.focusFile(file); this.showFiles.set(true); }
  uploadState(uploading: boolean) { if (uploading) this.chat.beginUpload(); else this.chat.uploading.set(false); }
  async deleteChat() {
    if (this.chat.streaming() || this.chat.uploading() || !confirm('Delete this saved conversation and its files?')) return;
    try { await this.api.deleteOrganizerFiles(this.chat.activeId()); this.chat.deleteChat(); }
    catch { this.toast.err('Could not delete session files. The conversation has been kept.'); }
  }

  private async loadAgentConfig() {
    try { const s = await this.api.organizerSystem(); this.sysPrompt = s.prompt; this.sysCustom.set(s.isCustom); this.docs.set(await this.api.organizerDocs()); this.knowledge.set(await this.api.knowledge()); const settings = await this.api.settings(); this.modelLabel.set(settings.model || 'Choose a model in Settings'); } catch { /* backend down */ }
  }
  async saveSys() { await this.api.setOrganizerSystem(this.sysPrompt); this.sysCustom.set(true); this.toast.ok('system prompt saved'); }
  async resetSys() { const r = await this.api.resetOrganizerSystem(); this.sysPrompt = r.prompt; this.sysCustom.set(false); this.toast.ok('reset to default'); }
  async addKb() { await this.api.addKnowledge({ title: this.kbTitle.trim(), content: this.kbContent.trim() }); this.kbTitle = ''; this.kbContent = ''; this.knowledge.set(await this.api.knowledge()); this.toast.ok('note added'); }
  async delKb(n: KnowledgeNote) { await this.api.deleteKnowledge(n.id); this.knowledge.set(await this.api.knowledge()); }
  async saveDoc(d: OrganizerDoc) { await this.api.saveDoc(d.name, d.content); this.docs.set(await this.api.organizerDocs()); this.toast.ok('doc saved'); }
  async resetDoc(d: OrganizerDoc) { await this.api.resetDoc(d.name); this.docs.set(await this.api.organizerDocs()); this.toast.ok('reset to default'); }
  async resetAllDocs() { await this.api.resetDocs(); this.docs.set(await this.api.organizerDocs()); this.toast.ok('all docs reset to default'); }
}
