import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { InspectorStore, InspectorItem, InspectorKind } from './inspector.store';
import { MarkdownPreviewComponent } from './markdown-preview.component';

/** The Organizer's live-editable inspector for files, techniques and prompts. */
@Component({
  selector: 'mg-inspector',
  imports: [FormsModule, MarkdownPreviewComponent],
  template: `
    <section class="inspector-panel">
      @if (store.current(); as it) {
        <header class="inspector-head">
          <div class="row" style="gap: 6px">
            <span class="chip lime">{{ kindLabel(it.kind) }}</span>
            @if (store.count() > 1) {
              <button class="btn ghost nav" (click)="store.prev()" title="Previous">◀</button>
              <span class="mono dim" style="font-size: 11px">{{ store.index() + 1 }} / {{ store.count() }}</span>
              <button class="btn ghost nav" (click)="store.next()" title="Next">▶</button>
            }
          </div>
          <div class="row" style="gap: 6px">
            @if (it.kind !== 'file') { <button class="btn" (click)="openInLibrary(it)" title="Open in its library">↗ library</button> }
            <button class="btn ghost" (click)="store.closeCurrent()" title="Close this item">✕</button>
            @if (store.count() > 1) { <button class="btn ghost" (click)="store.closeAll()">close all</button> }
          </div>
        </header>

        @switch (it.kind) {
          @case ('technique') {
            <input class="input" [ngModel]="it.data['title']" (ngModelChange)="store.patch('title', $event)" placeholder="title" />
            <label class="ins-label">Summary</label>
            <textarea class="textarea" [ngModel]="it.data['summary']" (ngModelChange)="store.patch('summary', $event)"></textarea>
            <label class="ins-label">Example</label>
            <textarea class="textarea" style="min-height: 150px" [ngModel]="it.data['example']" (ngModelChange)="store.patch('example', $event)"></textarea>
            <label class="ins-label">Tags</label>
            <input class="input" [ngModel]="it.data['tags']" (ngModelChange)="store.patch('tags', $event)" placeholder="direct, indirect, encoding" />
            @if (it.data['builtin']) { <p class="dim ins-note">Built-in — editable; the Technique library's “reset” restores the shipped default.</p> }
          }
          @case ('prompt') {
            <input class="input" [ngModel]="it.data['title']" (ngModelChange)="store.patch('title', $event)" placeholder="title" />
            <label class="ins-label">Body</label>
            <textarea class="textarea" style="min-height: 220px" [ngModel]="it.data['body']" (ngModelChange)="store.patch('body', $event)"></textarea>
            <div class="row" style="gap: 8px; margin-top: 8px">
              <input class="input grow" [ngModel]="it.data['tags']" (ngModelChange)="store.patch('tags', $event)" placeholder="tags" />
              <input class="input" style="max-width: 130px" [ngModel]="it.data['scenarioCode']" (ngModelChange)="store.patch('scenarioCode', $event)" placeholder="scenario" />
            </div>
          }
          @case ('file') {
            <textarea class="textarea" style="min-height: 240px" [ngModel]="it.data['content']" (ngModelChange)="store.patch('content', $event)"></textarea>
            @if (it.ext === 'md') { <label class="ins-label">Preview</label><mg-markdown-preview [content]="fileContent(it)" /> }
          }
          @case ('source-doc') {
            @if (it.ext === 'pdf' && it.data['blobUrl']) {
              <iframe [src]="trust(blobUrl(it))" class="src-frame" title="PDF document"></iframe>
            } @else if (it.ext === 'md') {
              <mg-markdown-preview [content]="docText(it)" />
            } @else {
              <pre class="file-text mono">{{ docText(it) }}</pre>
            }
            @if (it.data['description']) { <p class="dim ins-note">{{ it.data['description'] }}</p> }
          }
        }

        @if (it.kind !== 'source-doc' && it.kind !== 'source-link') {
          <div class="row inspector-foot">
            @if (it.dirty) { <span class="dim" style="font-size: 11px">unsaved changes</span> }
            <span class="grow"></span>
            <button class="btn primary" (click)="store.save()" [disabled]="!it.dirty || !!it.saving">{{ it.saving ? 'Saving…' : 'Save' }}</button>
          </div>
        }
      } @else {
        <div class="inspector-empty">
          <span class="empty-symbol" aria-hidden="true">◳</span>
          <p class="dim">Click a file, or ask Mr Goose to <em>"show technique X"</em> / <em>"show prompt Y"</em>. It opens here — live-editable.</p>
        </div>
      }
    </section>
  `,
  styles: [`
    .inspector-panel { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--surface-3); border-radius: 10px; background: var(--surface-1); padding: 12px; min-height: 180px }
    .inspector-head { display: flex; justify-content: space-between; align-items: center }
    .ins-label { font-size: 11px; color: var(--text-mute); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.04em }
    .ins-note { font-size: 11px; margin-top: 4px }
    .inspector-foot { margin-top: 4px }
    .file-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12.5px; max-height: 420px; overflow: auto; margin: 0 }
    .src-frame { width: 100%; height: 460px; border: 1px solid var(--surface-3); border-radius: 6px; background: #fff }
    .link { color: var(--lime); text-decoration: underline }
    .btn.nav { padding: 2px 8px; height: 24px }
    .inspector-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 16px; text-align: center }
    .empty-symbol { font-size: 26px; opacity: 0.5 }
  `],
})
export class InspectorComponent {
  readonly store = inject(InspectorStore);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  kindLabel(k: InspectorKind) { return ({ file: 'File', technique: 'Technique', prompt: 'Prompt', 'source-doc': 'Source doc', 'source-link': 'Source link' } as Record<InspectorKind, string>)[k]; }
  fileContent(it: InspectorItem) { return (it.data['content'] as string) ?? ''; }
  docText(it: InspectorItem) { return (it.data['text'] as string) ?? ''; }
  blobUrl(it: InspectorItem) { return (it.data['blobUrl'] as string) ?? ''; }
  trust(url: string): SafeResourceUrl { return this.sanitizer.bypassSecurityTrustResourceUrl(url); }
  openInLibrary(it: InspectorItem) {
    if (it.kind === 'technique') void this.router.navigate(['/techniques']);
    else if (it.kind === 'prompt') void this.router.navigate(['/prompts']);
    else if (it.kind === 'source-doc' || it.kind === 'source-link') void this.router.navigate(['/sources']);
  }
}
