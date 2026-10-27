import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { BackendService } from './backend.service';

export type InspectorKind = 'file' | 'technique' | 'prompt' | 'source-doc' | 'source-link';
export interface InspectorItem {
  key: string;               // `${kind}:${id}` — identity for de-duping open items
  kind: InspectorKind;
  id: string;
  title: string;
  ext?: string;              // file extension (files only)
  data: Record<string, unknown>;
  dirty: boolean;
  saving?: boolean;
}

/**
 * The Organizer's shared inspector: a stack of open items (files, techniques, prompts) shown one at a
 * time with prev/next navigation. Techniques and prompts are live-editable and save to the library; the
 * in-app agent (and, later, an MCP client) can push items here. A singleton so any surface can open into it.
 */
@Injectable({ providedIn: 'root' })
export class InspectorStore {
  private api = inject(ApiService);
  private backend = inject(BackendService);
  readonly items = signal<InspectorItem[]>([]);
  readonly index = signal(0);
  readonly current = computed(() => this.items()[this.index()] ?? null);
  readonly count = computed(() => this.items().length);

  constructor() {
    // The in-app agent and MCP both push opens/edits through the hub; reflect them live.
    // Techniques/prompts/source-docs open in the inspector; a source-link opens its own browser window.
    this.backend.onOrganizerOpen(i => { if (['technique', 'prompt', 'source-doc', 'source-link'].includes(i.kind)) void this.open(i.kind as InspectorKind, i.id); });
    this.backend.onOrganizerChanged(i => void this.refreshIfOpen(i.kind, i.id));
  }
  // Re-fetch an item already open in the inspector (e.g. after an external MCP edit).
  async refreshIfOpen(kind: string, id: string) {
    if (!this.items().some(x => x.key === `${kind}:${id}`)) return;
    if (kind === 'technique') await this.openTechnique(id);
    else if (kind === 'prompt') await this.openPrompt(id);
  }

  private focus(item: InspectorItem) {
    const items = this.items();
    const i = items.findIndex(x => x.key === item.key);
    if (i >= 0) { const next = [...items]; next[i] = item; this.items.set(next); this.index.set(i); }
    else { this.items.set([...items, item]); this.index.set(items.length); }
  }
  patch(field: string, value: unknown) {
    const i = this.index(), items = this.items(); const cur = items[i]; if (!cur) return;
    const next = [...items]; next[i] = { ...cur, data: { ...cur.data, [field]: value }, dirty: true }; this.items.set(next);
  }
  prev() { if (this.count()) this.index.set((this.index() - 1 + this.count()) % this.count()); }
  next() { if (this.count()) this.index.set((this.index() + 1) % this.count()); }
  go(i: number) { if (i >= 0 && i < this.count()) this.index.set(i); }
  closeAt(i: number) { const items = this.items().filter((_, k) => k !== i); this.items.set(items); if (this.index() >= items.length) this.index.set(Math.max(0, items.length - 1)); }
  closeCurrent() { this.closeAt(this.index()); }
  closeAll() { this.items.set([]); this.index.set(0); }

  async openTechnique(id: string | number) {
    const t = (await this.api.techniques()).find(x => x.id === +id); if (!t) return;
    this.focus({ key: `technique:${t.id}`, kind: 'technique', id: String(t.id), title: t.title,
      data: { title: t.title, summary: t.summary, example: t.example, tags: t.tags, builtin: t.builtin }, dirty: false });
  }
  async openPrompt(id: string | number) {
    const p = (await this.api.prompts()).find(x => x.id === +id); if (!p) return;
    this.focus({ key: `prompt:${p.id}`, kind: 'prompt', id: String(p.id), title: p.title,
      data: { title: p.title, body: p.body, tags: p.tags, scenarioCode: p.scenarioCode, verdict: p.verdict }, dirty: false });
  }
  async openFile(sessionId: string, fileId: string) {
    try {
      const c = await this.api.organizerFile(sessionId, fileId);
      this.focus({ key: `file:${fileId}`, kind: 'file', id: fileId, title: c.file.name,
        ext: c.file.name.split('.').pop()?.toLowerCase(), data: { content: c.content, sessionId }, dirty: false });
    } catch { /* ignore */ }
  }
  async openSourceDoc(id: string | number) {
    try {
      const meta = await this.api.sourceDocText(+id);
      let blobUrl = '';
      if (meta.type === 'pdf') { try { const blob = await this.api.sourceDocContent(+id); blobUrl = URL.createObjectURL(blob as Blob); } catch { /* */ } }
      this.focus({ key: `source-doc:${id}`, kind: 'source-doc', id: String(id), title: meta.name, ext: meta.type,
        data: { type: meta.type, text: meta.text, blobUrl, description: meta.description }, dirty: false });
    } catch { /* ignore */ }
  }
  // A link is NOT an inspector item: it opens in its own standalone browser window (Electron),
  // falling back to a new browser tab outside Electron.
  async openSourceLink(id: string | number) {
    const l = (await this.api.sourceLinks()).find(x => x.id === +id); if (!l) return;
    this.openUrlExternal(l.url);
  }
  openUrlExternal(url: string) {
    let u = (url || '').trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u; // bare domains (e.g. "google.de") need a scheme
    if (window.mrgoose?.openUrl) void window.mrgoose.openUrl(u);
    else window.open(u, '_blank', 'noopener');
  }
  async open(kind: InspectorKind, id: string, sessionId = '') {
    if (kind === 'technique') await this.openTechnique(id);
    else if (kind === 'prompt') await this.openPrompt(id);
    else if (kind === 'file') await this.openFile(sessionId, id);
    else if (kind === 'source-doc') await this.openSourceDoc(id);
    else if (kind === 'source-link') await this.openSourceLink(id);
  }

  async save() {
    const cur = this.current(); if (!cur || cur.saving) return;
    this.replace(cur.key, x => ({ ...x, saving: true }));
    try {
      if (cur.kind === 'technique')
        await this.api.updateTechnique(+cur.id, { title: cur.data['title'] as string, summary: cur.data['summary'] as string, example: cur.data['example'] as string, tags: cur.data['tags'] as string });
      else if (cur.kind === 'prompt')
        await this.api.updatePrompt(+cur.id, { title: cur.data['title'] as string, body: cur.data['body'] as string, tags: cur.data['tags'] as string, scenarioCode: cur.data['scenarioCode'] as string, verdict: cur.data['verdict'] as string });
      else if (cur.kind === 'file')
        await this.api.updateOrganizerFile(cur.data['sessionId'] as string, cur.id, cur.data['content'] as string);
      this.replace(cur.key, x => ({ ...x, saving: false, dirty: false, title: (cur.data['title'] as string) || x.title }));
    } catch { this.replace(cur.key, x => ({ ...x, saving: false })); }
  }
  private replace(key: string, fn: (x: InspectorItem) => InspectorItem) {
    const items = this.items(); const i = items.findIndex(x => x.key === key); if (i < 0) return;
    const next = [...items]; next[i] = fn(next[i]); this.items.set(next);
  }
}
