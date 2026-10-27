import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { InspectorStore } from '../inspector.store';
import { SourceLinkDto, SourceDocDto } from '../models';

@Component({
  selector: 'mg-sources',
  imports: [FormsModule],
  template: `
    <section class="page" style="max-width: 920px">
      <header class="page-head">
        <span class="label-mono">Source Library</span>
        <h1>Source Library</h1>
        <p class="sub">Research sources for techniques: save links and documents (PDF / text). Links open in a separate browser window; documents open in the inspector. Or ask Mr Goose Organizer to “show me the source documents” and “extract the jailbreak techniques”.</p>
      </header>

      <div class="card">
        <span class="label-mono">Links</span>
        <div class="row" style="gap: 6px; margin-top: 8px; flex-wrap: wrap">
          <input class="input" style="max-width: 200px" [(ngModel)]="linkTitle" placeholder="title (optional)" />
          <input class="input grow" [(ngModel)]="linkUrl" placeholder="https://…" />
        </div>
        <div class="row" style="gap: 6px; margin-top: 6px">
          <input class="input grow" [(ngModel)]="linkDesc" placeholder="description — what's useful here" />
          <button class="btn primary" (click)="addLink()" [disabled]="!linkUrl.trim()">+ add link</button>
        </div>
        @for (l of links(); track l.id) {
          <div class="card" style="margin-top: 8px; padding: 9px 11px">
            <div class="row spread">
              <div style="min-width: 0">
                <strong style="font-size: 13px">{{ l.title || l.url }}</strong>
                <div class="mono dim" style="font-size: 11px; overflow-wrap: anywhere">{{ l.url }}</div>
                @if (l.description) { <p class="dim" style="font-size: 12px; margin: 4px 0 0">{{ l.description }}</p> }
              </div>
              <div class="row" style="gap: 6px"><button class="btn" (click)="viewLink(l)" title="Open in a separate browser window">open ↗</button><button class="btn danger" (click)="delLink(l)">×</button></div>
            </div>
          </div>
        }
        @if (!links().length) { <p class="muted" style="font-size: 12px; margin-top: 8px">No links yet.</p> }
      </div>

      <div class="card">
        <span class="label-mono">Documents</span>
        <p class="muted" style="font-size: 12px; margin: 6px 0">PDF / .txt / .md / .json / .csv, up to 20 MiB. PDFs are text-extracted so the agent can read them.</p>
        <div class="row" style="gap: 6px">
          <input class="input grow" [(ngModel)]="docDesc" placeholder="description (optional)" />
          <input #picker type="file" accept=".pdf,.txt,.md,.json,.csv" hidden (change)="pick($event)" />
          <button class="btn primary" (click)="picker.click()" [disabled]="uploading()">{{ uploading() ? 'Uploading…' : 'Upload' }}</button>
        </div>
        @for (d of docs(); track d.id) {
          <div class="card" style="margin-top: 8px; padding: 9px 11px">
            <div class="row spread">
              <div style="min-width: 0">
                <span class="chip">{{ d.type }}</span> <strong style="font-size: 13px">{{ d.name }}</strong>
                <div class="dim" style="font-size: 11px">{{ size(d.size) }}@if (!d.hasText) { · no extractable text }</div>
                @if (d.description) { <p class="dim" style="font-size: 12px; margin: 4px 0 0">{{ d.description }}</p> }
              </div>
              <div class="row" style="gap: 6px"><button class="btn" (click)="viewDoc(d)">view</button><button class="btn danger" (click)="delDoc(d)">×</button></div>
            </div>
          </div>
        }
        @if (!docs().length) { <p class="muted" style="font-size: 12px; margin-top: 8px">No documents yet.</p> }
      </div>
    </section>
  `,
})
export class SourcesPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private inspector = inject(InspectorStore);
  readonly links = signal<SourceLinkDto[]>([]);
  readonly docs = signal<SourceDocDto[]>([]);
  readonly uploading = signal(false);
  linkTitle = ''; linkUrl = ''; linkDesc = ''; docDesc = '';

  constructor() { this.load(); }
  async load() { try { this.links.set(await this.api.sourceLinks()); this.docs.set(await this.api.sourceDocs()); } catch { /* backend down */ } }
  async addLink() {
    if (!this.linkUrl.trim()) return;
    let url = this.linkUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url; // store a full URL so bare domains open correctly
    await this.api.addSourceLink({ title: this.linkTitle.trim(), url, description: this.linkDesc.trim() });
    this.linkTitle = ''; this.linkUrl = ''; this.linkDesc = '';
    this.links.set(await this.api.sourceLinks()); this.toast.ok('link saved');
  }
  async delLink(l: SourceLinkDto) { await this.api.deleteSourceLink(l.id); this.links.set(await this.api.sourceLinks()); }
  async pick(ev: Event) {
    const input = ev.target as HTMLInputElement; const file = input.files?.[0]; input.value = '';
    if (!file) return;
    this.uploading.set(true);
    try { await this.api.uploadSourceDoc(file, this.docDesc.trim()); this.docDesc = ''; this.docs.set(await this.api.sourceDocs()); this.toast.ok('document uploaded'); }
    catch { this.toast.err('upload failed — check type/size'); }
    this.uploading.set(false);
  }
  async delDoc(d: SourceDocDto) { await this.api.deleteSourceDoc(d.id); this.docs.set(await this.api.sourceDocs()); }
  async viewDoc(d: SourceDocDto) { await this.inspector.openSourceDoc(d.id); void this.router.navigate(['/organizer']); }
  // Links open in their own standalone browser window — not the inspector, so we stay on this page.
  viewLink(l: SourceLinkDto) { this.inspector.openUrlExternal(l.url); }
  size(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
}
