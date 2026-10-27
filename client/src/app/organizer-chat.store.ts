import { Injectable, computed, inject, signal } from '@angular/core';
import { BackendService, ChatMsg } from './backend.service';
import { OrganizerFileInfo } from './models';
import { ArenaService } from './arena.service';
import { ToastService } from './toast.service';
import { AgentConversation, readAgentHistory, sessionTitle, ViewItem } from './organizer-chat-history';
import { toolLabel } from './tool-labels';
export type { ViewItem } from './organizer-chat-history';

/** Local, persistent conversations for the Mr Goose Organizer; only the active chat is sent to the model. */
@Injectable({ providedIn: 'root' })
export class OrganizerChatStore {
  private backend = inject(BackendService);
  private arena = inject(ArenaService);
  private toast = inject(ToastService);

  readonly view = signal<ViewItem[]>([]);
  readonly streaming = signal(false);
  private convo: ChatMsg[] = [];
  readonly sessions = signal<AgentConversation[]>([]);
  readonly activeId = signal<string>(crypto.randomUUID());
  readonly historyError = signal('');
  readonly filesRevision = signal(0);
  readonly uploading = signal(false);
  readonly currentTitle = computed(() => this.sessions().find(s => s.id === this.activeId())?.title ?? 'New session');
  private readonly storageKey = `mg.agent-history.v1:${this.backend.backendUrl}`;
  private storageReadable = true;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.restore();
    // register the page-action handler once (persists for the app lifetime)
    this.backend.onOrganizerPageAction((a) => this.handlePageAction(a));
  }

  newChat() {
    if (this.streaming() || this.uploading() || !this.view().length) return;
    this.activeId.set(crypto.randomUUID()); this.view.set([]); this.convo = [];
    this.save();
  }

  selectChat(id: string) {
    if (this.streaming() || this.uploading()) return;
    const session = this.sessions().find(s => s.id === id);
    if (!session) return;
    this.activeId.set(id); this.view.set(session.view); this.convo = [...session.messages];
    this.persist();
  }

  deleteChat() {
    if (this.streaming() || this.uploading()) return;
    this.sessions.update(s => s.filter(c => c.id !== this.activeId()));
    const next = this.sessions()[0];
    this.activeId.set(next?.id ?? crypto.randomUUID());
    this.view.set(next?.view ?? []); this.convo = [...(next?.messages ?? [])];
    this.persist();
  }

  beginUpload() { this.uploading.set(true); this.save(); }

  recordFile(file: OrganizerFileInfo) {
    if (!this.view().some(v => v.type === 'file' && v.file?.id === file.id))
      this.view.update(v => [...v, { type: 'file', text: file.name, file }]);
    this.filesRevision.update(n => n + 1); this.save();
  }

  renameChat(title: string) {
    title = title.trim().slice(0, 80);
    if (!title || this.streaming()) return;
    this.save();
    this.sessions.update(s => s.map(c => c.id === this.activeId() ? { ...c, title, titleSource: 'custom' } : c));
    this.persist();
  }

  private restore() {
    try {
      const history = readAgentHistory(localStorage.getItem(this.storageKey));
      if (!history) return;
      let changed = false;
      const sessions = history.sessions.map((s): AgentConversation => {
        let next = s;
        const oldAutoTitle = s.view.find(v => v.type === 'user')?.text.replace(/\s+/g, ' ').slice(0, 72);
        if (!s.titleSource && oldAutoTitle && s.title === oldAutoTitle) {
          next = { ...next, title: sessionTitle(s.updatedAt), titleSource: 'auto' }; changed = true;
        }
        if (s.running) {
          next = { ...next, running: false, view: [...next.view,
            { type: 'tool', text: 'Response interrupted when the app closed. Partial output has been retained; tool actions may already have completed. Check before retrying.' }] };
          changed = true;
        }
        return next;
      });
      this.sessions.set(sessions);
      const active = sessions.find(s => s.id === history.activeId) ?? sessions[0];
      if (active) { this.activeId.set(active.id); this.view.set(active.view); this.convo = [...active.messages]; }
      if (changed) this.persist();
    } catch {
      this.storageReadable = false;
      this.historyError.set('Saved chat history could not be read. This chat stays in memory; existing saved data has been preserved.');
    }
  }

  private save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const existing = this.sessions().find(c => c.id === this.activeId());
    const now = new Date().toISOString();
    const session: AgentConversation = {
      id: this.activeId(), title: existing?.title ?? sessionTitle(now), titleSource: existing?.titleSource ?? 'auto',
      updatedAt: now, view: this.view(), messages: [...this.convo], running: this.streaming(),
    };
    this.sessions.update(s => [session, ...s.filter(c => c.id !== session.id)]);
    this.persist();
  }

  private persist() {
    if (!this.storageReadable) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({ version: 1, activeId: this.activeId(), sessions: this.sessions() }));
      this.historyError.set('');
    } catch {
      this.historyError.set('Chat history could not be saved locally. This conversation remains available until the app closes.');
    }
  }

  async send(text: string) {
    text = text.trim();
    if (this.streaming() || this.uploading() || !text) return;
    this.convo.push({ role: 'user', content: text });
    this.view.update(v => [...v, { type: 'user', text }]);
    this.streaming.set(true);
    this.save();
    let full = '';
    await this.backend.organizerChat(
      this.convo,
      (tok) => { full += tok; this.appendAsst('text', tok); },
      (name) => { this.view.update(v => [...v, { type: 'tool', text: toolLabel(name) }]); this.save(); },
      (ok) => { this.filesRevision.update(n => n + 1); this.streaming.set(false); if (full) this.convo.push({ role: 'assistant', content: full }); this.save(); if (!ok) this.toast.err('agent failed — check connection and OpenRouter settings'); },
      (tok) => this.appendAsst('reasoning', tok),
      (rows) => { this.view.update(v => [...v, { type: 'techniques', text: 'Technique library', techniques: rows }]); this.save(); },
      (file) => this.recordFile(file),
      this.activeId(),
    );
  }

  toggleReasoning(i: number) { this.view.update(v => { const a = [...v]; if (a[i]) a[i] = { ...a[i], reasoningOpen: !a[i].reasoningOpen }; return a; }); }

  private appendAsst(kind: 'text' | 'reasoning', tok: string) {
    this.view.update(v => {
      const a = [...v];
      let last = a[a.length - 1];
      if (!last || last.type !== 'assistant') { last = { type: 'assistant', text: '', reasoning: '' }; a.push(last); }
      else { last = { ...last }; a[a.length - 1] = last; }
      if (kind === 'text') last.text = (last.text || '') + tok; else last.reasoning = (last.reasoning || '') + tok;
      return a;
    });
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.save(), 500);
  }

  private async handlePageAction(a: { id: string; name: string; args: string }) {
    let args: any = {};
    try { args = JSON.parse(a.args || '{}'); } catch { /* */ }
    let res: any;
    try {
    if (['arena_fill', 'arena_read', 'arena_snapshot', 'arena_pick'].includes(a.name) && !args.tabId) throw new Error('Explicit tabId required');
    if (a.name === 'arena_open_tab') { const id = await this.arena.create(args.url); res = { ok: !!id, note: id ? `opened ${id}` : 'failed' }; }
    else if (a.name === 'arena_fill') res = await this.arena.fill(args.selector, args.value, args.tabId);
    else if (a.name === 'arena_read') res = await this.arena.read(args.selector, args.tabId);
    else if (a.name === 'arena_snapshot') res = await this.arena.snapshot(args.selector, args.tabId);
    else if (a.name === 'arena_pick') res = await this.arena.pick(args.tabId);
    else if (a.name === 'arena_list_tabs') res = { ok: true, note: JSON.stringify(await this.arena.list()) };
    else if (a.name === 'arena_select_tab') res = { ok: true, note: JSON.stringify(await this.arena.select(args.id)) };
    else if (a.name === 'arena_close_tab') res = { ok: true, note: JSON.stringify(await this.arena.close(args.id)) };
    else res = { ok: false, note: 'unknown page action' };
    } catch (error) { res = { ok: false, note: error instanceof Error ? error.message : 'Page action failed' }; }
    this.view.update(v => [...v, { type: 'tool', text: `${toolLabel(a.name)} → ${res.ok ? 'ok' : (res.note || 'failed')}` }]);
    this.save();
    this.backend.organizerPageResult(a.id, JSON.stringify(res));
  }

  private short(s: string) { return s.length > 80 ? s.slice(0, 80) + '…' : s; }
}
