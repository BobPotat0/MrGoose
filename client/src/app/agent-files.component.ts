import { Component, EventEmitter, Input, Output, OnChanges, OnDestroy, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AgentFileContent, AgentFileInfo } from './models';
import { csvPreview } from './csv-preview';
import { MarkdownPreviewComponent } from './markdown-preview.component';

@Component({
  selector: 'mg-agent-files',
  imports: [MarkdownPreviewComponent],
  template: `
    <aside class="files-panel" [class.drag-active]="dragActive()" aria-label="Session files" (dragenter)="dragEnter($event)" (dragover)="dragOver($event)" (dragleave)="dragLeave($event)" (drop)="drop($event)">
      <header class="files-head"><div><span class="label-mono">Files</span><p>Current session</p></div><div class="upload-actions"><input #picker type="file" accept=".txt,.md,.json,.csv" multiple hidden (change)="pick($event)"><button class="btn refresh" type="button" (click)="picker.click()" [disabled]="uploading()">Upload</button><button class="btn ghost refresh" type="button" (click)="load()" [disabled]="loading()">Refresh</button></div></header>
      <div class="drop-zone"><span>{{ dragActive() ? 'Drop to upload' : uploading() ? 'Uploading…' : 'Drop files here or choose Upload' }}</span><small>.txt · .md · .json · .csv · up to 1 MiB each</small></div>
      @if (uploadMessage()) { <p class="file-note" role="status">{{ uploadMessage() }}</p> }
      @if (error()) { <p class="file-error" role="status">{{ error() }}</p> }
      @if (loading()) { <p class="file-note" role="status">Loading files…</p> }
      @if (!loading() && !error() && !files().length) {
        <div class="files-empty"><span class="empty-symbol" aria-hidden="true">▤</span><h2>No files yet</h2><p>Ask Mr Goose to save a payload, report or table as a file.</p><span class="mono">.txt · .md · .json · .csv</span></div>
      }
      <div class="file-list">
        @for (file of files(); track file.id) {
          <button class="file-item" type="button" (click)="select(file)" [class.active]="selected()?.id === file.id" [attr.aria-pressed]="selected()?.id === file.id">
            <span class="file-extension mono">{{ extension(file.name) }}</span><span class="file-identity"><strong>{{ file.name }}</strong><small>{{ file.source === 'upload' ? 'Uploaded' : 'Created' }} · {{ size(file.size) }} · {{ date(file.createdAt) }}</small></span>
          </button>
        }
      </div>
      @if (selected(); as file) {
        <section class="file-preview" aria-label="File preview">
          <div class="preview-title"><strong>{{ file.name }}</strong><button class="btn" type="button" (click)="download()" [disabled]="downloading()">{{ downloading() ? 'Downloading…' : 'Download' }}</button></div>
          @if (reading()) { <p class="file-note" role="status">Opening file…</p> }
          @if (preview(); as value) {
            <div class="preview-toolbar">
              <div class="preview-modes" aria-label="Preview mode">
                @if (extension(file.name) === 'md') { <button type="button" (click)="mode.set('markdown')" [attr.aria-pressed]="mode() === 'markdown'">Preview</button> }
                @if (extension(file.name) === 'csv') { <button type="button" (click)="mode.set('table')" [attr.aria-pressed]="mode() === 'table'">Table</button> }
                <button type="button" (click)="mode.set('text')" [attr.aria-pressed]="mode() === 'text'">{{ extension(file.name) === 'md' ? 'Source' : extension(file.name) === 'json' ? 'JSON' : 'Text' }}</button>
              </div><span class="file-note">Read-only preview</span>
            </div>
            @if (extension(file.name) === 'md' && mode() === 'markdown') {
              <mg-markdown-preview [content]="value.content" />
            } @else if (extension(file.name) === 'csv' && mode() === 'table') {
              @if (csv().error) { <p class="file-error">{{ csv().error }}</p> }
              @else {
                <div class="csv-scroll"><table><thead><tr>@for (cell of csv().rows[0] || []; track $index) { <th scope="col">{{ cell }}</th> }</tr></thead><tbody>
                  @for (row of csv().rows.slice(1); track $index) { <tr>@for (cell of row; track $index) { <td>{{ cell }}</td> }</tr> }
                </tbody></table></div>
                @if (csv().truncated) { <p class="file-note">Preview limited to 200 data rows / 50 columns. Download contains the full file.</p> }
              }
            } @else { <pre class="file-text mono">{{ displayText() }}</pre> }
            @if (!value.content) { <p class="file-note">This file is empty.</p> }
          }
        </section>
      }
    </aside>
  `,
  styleUrl: './agent-files.component.css',
})
export class AgentFilesComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) sessionId = '';
  @Input() revision = 0;
  @Input() openFileId = '';
  @Output() fileUploaded = new EventEmitter<AgentFileInfo>();
  @Output() fileSelected = new EventEmitter<AgentFileInfo>();
  @Output() uploadingChange = new EventEmitter<boolean>();
  private api = inject(ApiService);
  readonly files = signal<AgentFileInfo[]>([]);
  readonly selected = signal<AgentFileInfo | null>(null);
  readonly preview = signal<AgentFileContent | null>(null);
  readonly loading = signal(false);
  readonly reading = signal(false);
  readonly downloading = signal(false);
  readonly error = signal('');
  readonly mode = signal<'table' | 'text' | 'markdown'>('text');
  readonly uploading = signal(false);
  readonly dragActive = signal(false);
  readonly uploadMessage = signal('');
  private dragDepth = 0;
  readonly csv = computed(() => csvPreview(this.preview()?.content ?? ''));
  readonly displayText = computed(() => {
    const p = this.preview(); if (!p) return '';
    if (this.extension(p.file.name) === 'json') { try { return JSON.stringify(JSON.parse(p.content), null, 2); } catch { /* show the exact source if invalid */ } }
    return p.content;
  });
  private listRequest = 0;
  private readRequest = 0;
  private lastSession = '';
  private destroyed = false;
  ngOnChanges() { void this.load(); }
  ngOnDestroy() { this.destroyed = true; this.listRequest++; this.readRequest++; if (this.uploading()) this.uploadingChange.emit(false); }

  async load() {
    const ticket = ++this.listRequest, session = this.sessionId;
    if (session !== this.lastSession) {
      this.files.set([]); this.selected.set(null); this.preview.set(null); this.reading.set(false); this.readRequest++;
      this.lastSession = session;
    }
    this.loading.set(true); this.error.set('');
    try {
      const files = await this.api.agentFiles(session);
      if (this.destroyed || ticket !== this.listRequest) return;
      this.files.set(files);
      const selected = this.selected();
      const requested = files.find(f => f.id === this.openFileId);
      if (requested && requested.id !== selected?.id) void this.select(requested, false);
      if (selected && !files.some(f => f.id === selected.id)) { this.selected.set(null); this.preview.set(null); this.readRequest++; this.reading.set(false); }
    } catch { if (!this.destroyed && ticket === this.listRequest) this.error.set('Could not load session files. Check the backend and retry.'); }
    finally { if (!this.destroyed && ticket === this.listRequest) this.loading.set(false); }
  }

  async select(file: AgentFileInfo, announce = true) {
    const ticket = ++this.readRequest, session = this.sessionId;
    this.selected.set(file); if (announce) this.fileSelected.emit(file); this.preview.set(null); this.reading.set(true); this.error.set('');
    this.mode.set(this.extension(file.name) === 'md' ? 'markdown' : this.extension(file.name) === 'csv' ? 'table' : 'text');
    try {
      const content = await this.api.agentFile(session, file.id);
      if (!this.destroyed && ticket === this.readRequest && session === this.sessionId) this.preview.set(content);
    } catch { if (!this.destroyed && ticket === this.readRequest) this.error.set('Could not open this file. Select it to retry.'); }
    finally { if (!this.destroyed && ticket === this.readRequest) this.reading.set(false); }
  }

  async download() {
    const file = this.selected(), session = this.sessionId;
    if (!file || this.downloading()) return;
    this.downloading.set(true); this.error.set('');
    try {
      const blob = await this.api.agentFileDownload(session, file.id);
      if (this.destroyed || session !== this.sessionId) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (!this.destroyed && session === this.sessionId) this.error.set('Download failed. Please retry.'); }
    finally { if (!this.destroyed) this.downloading.set(false); }
  }

  pick(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []); input.value = '';
    void this.upload(files);
  }

  dragEnter(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); this.dragDepth++; this.dragActive.set(true);
  }
  dragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }
  dragLeave(event: DragEvent) { event.preventDefault(); this.dragDepth = Math.max(0, this.dragDepth - 1); if (!this.dragDepth) this.dragActive.set(false); }
  drop(event: DragEvent) {
    event.preventDefault(); event.stopPropagation(); this.dragDepth = 0; this.dragActive.set(false);
    void this.upload(Array.from(event.dataTransfer?.files ?? []));
  }

  async upload(files: File[]) {
    if (this.uploading() || !files.length) return;
    const session = this.sessionId; const problems: string[] = []; let count = 0;
    this.uploading.set(true); this.uploadingChange.emit(true); this.uploadMessage.set(''); this.error.set('');
    try {
      for (const file of files) {
        if (this.destroyed || session !== this.sessionId) break;
        if (!['txt', 'md', 'json', 'csv'].includes(this.extension(file.name)) || file.size > 1024 * 1024) {
          problems.push(`${file.name}: use a supported text file up to 1 MiB.`); continue;
        }
        try {
          const saved = await this.api.uploadAgentFile(session, file); count++;
          if (!this.destroyed && session === this.sessionId) this.fileUploaded.emit(saved);
        } catch { problems.push(`${file.name}: upload failed. Check UTF-8 format and retry.`); }
      }
      if (!this.destroyed && session === this.sessionId) {
        await this.load(); this.uploadMessage.set(count ? `Uploaded ${count} file${count === 1 ? '' : 's'}.` : '');
        if (problems.length) this.error.set(problems.join(' '));
      }
    } finally { this.uploading.set(false); if (!this.destroyed) this.uploadingChange.emit(false); }
  }

  extension(name: string) { return name.split('.').pop()?.toLowerCase() ?? 'txt'; }
  size(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`; }
  date(timestamp: string) { return new Date(timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
}
