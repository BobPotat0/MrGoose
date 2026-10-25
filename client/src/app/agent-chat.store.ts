import { Injectable, inject, signal } from '@angular/core';
import { BackendService, ChatMsg } from './backend.service';
import { ArenaService } from './arena.service';
import { ToastService } from './toast.service';

export type ViewItem = { type: 'user' | 'assistant' | 'tool'; text: string; reasoning?: string; reasoningOpen?: boolean };

/** Singleton store for the Mr Goose Agent conversation so it survives navigating between tabs. */
@Injectable({ providedIn: 'root' })
export class AgentChatStore {
  private backend = inject(BackendService);
  private arena = inject(ArenaService);
  private toast = inject(ToastService);

  readonly view = signal<ViewItem[]>([]);
  readonly streaming = signal(false);
  private convo: ChatMsg[] = [];
  private wired = false;

  constructor() {
    // register the page-action handler once (persists for the app lifetime)
    this.backend.onAgentPageAction((a) => this.handlePageAction(a));
    this.wired = true;
  }

  clear() { this.view.set([]); this.convo = []; }

  async send(text: string) {
    text = text.trim();
    if (this.streaming() || !text) return;
    this.convo.push({ role: 'user', content: text });
    this.view.update(v => [...v, { type: 'user', text }]);
    this.streaming.set(true);
    let full = '';
    await this.backend.agentChat(
      this.convo,
      (tok) => { full += tok; this.appendAsst('text', tok); },
      (name, args) => this.view.update(v => [...v, { type: 'tool', text: `${name} ${this.short(args)}` }]),
      (ok) => { this.streaming.set(false); if (full) this.convo.push({ role: 'assistant', content: full }); if (!ok) this.toast.err('agent failed — check OpenRouter key'); },
      (tok) => this.appendAsst('reasoning', tok),
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
  }

  private async handlePageAction(a: { id: string; name: string; args: string }) {
    let args: any = {};
    try { args = JSON.parse(a.args || '{}'); } catch { /* */ }
    let res: any;
    if (a.name === 'arena_open_tab') { const id = await this.arena.create(args.url); res = { ok: !!id, note: id ? `opened ${id}` : 'failed' }; }
    else if (a.name === 'arena_fill') res = await this.arena.fill(args.selector, args.value);
    else if (a.name === 'arena_read') res = await this.arena.read(args.selector);
    else if (a.name === 'arena_snapshot') res = await this.arena.snapshot(args.selector);
    else if (a.name === 'arena_pick') res = await this.arena.pick();
    else if (a.name === 'arena_list_tabs') res = { ok: true, note: JSON.stringify(await this.arena.list()) };
    else if (a.name === 'arena_select_tab') res = { ok: true, note: JSON.stringify(await this.arena.select(args.id)) };
    else if (a.name === 'arena_close_tab') res = { ok: true, note: JSON.stringify(await this.arena.close(args.id)) };
    else res = { ok: false, note: 'unknown page action' };
    this.view.update(v => [...v, { type: 'tool', text: `page ${a.name} → ${res.ok ? 'ok' : (res.note || 'failed')}` }]);
    this.backend.agentPageResult(a.id, JSON.stringify(res));
  }

  private short(s: string) { return s.length > 80 ? s.slice(0, 80) + '…' : s; }
}
