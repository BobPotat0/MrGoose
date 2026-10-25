import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackendService } from '../backend.service';
import { ArenaService } from '../arena.service';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { AgentChatStore } from '../agent-chat.store';
import { KnowledgeNote, AgentDoc } from '../models';

@Component({
  selector: 'mg-assistant',
  imports: [FormsModule],
  template: `
    <section class="page" style="max-width:920px">
      <header class="page-head">
        <span class="label-mono">Mr Goose Agent</span>
        <h1>Mr Goose Agent</h1>
        <p class="sub">Your assistant for the whole tool. It can manage the prompt library + folders, techniques, challenges &amp; objectives, recon/verdicts, its own knowledge base, encode payloads, and (in the embedded arena) open tabs + fill fields — never send. Just ask.</p>
      </header>

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

      <div class="card" style="min-height:320px">
        @for (v of chat.view(); track $index) {
          @if (v.type==='tool') { <div class="mono" style="font-size:11px;color:var(--amber);margin:4px 0">⚙ {{ v.text }}</div> }
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

      <div class="card">
        <textarea class="textarea" [(ngModel)]="input" (keydown.control.enter)="send()" placeholder="ask Mr Goose to do something… (Ctrl+Enter)"></textarea>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" (click)="send()" [disabled]="chat.streaming() || !input.trim()">{{ chat.streaming() ? 'working…' : 'send (Ctrl+Enter)' }}</button>
          @if (chat.view().length) { <button class="btn" (click)="chat.clear()">clear</button> }
          <span class="grow"></span>
          <span class="chip" [class.amber]="backend.hub()!=='connected'">hub {{ backend.hub() }}</span>
          <span class="chip" [class.lime]="arena.available">{{ arena.available ? 'arena ready' : 'arena: electron only' }}</span>
        </div>
      </div>
    </section>
  `,
})
export class AssistantPage {
  backend = inject(BackendService);
  arena = inject(ArenaService);
  chat = inject(AgentChatStore);
  private api = inject(ApiService);
  private toast = inject(ToastService);

  input = '';

  // system prompt + knowledge base
  readonly showSys = signal(false);
  readonly showKb = signal(false);
  readonly sysCustom = signal(false);
  readonly knowledge = signal<KnowledgeNote[]>([]);
  readonly docs = signal<AgentDoc[]>([]);
  readonly openDoc = signal('');
  sysPrompt = ''; kbTitle = ''; kbContent = '';

  constructor() { this.loadAgentConfig(); }

  send() { const t = this.input; this.input = ''; this.chat.send(t); }

  private async loadAgentConfig() {
    try { const s = await this.api.agentSystem(); this.sysPrompt = s.prompt; this.sysCustom.set(s.isCustom); this.docs.set(await this.api.agentDocs()); this.knowledge.set(await this.api.knowledge()); } catch { /* backend down */ }
  }
  async saveSys() { await this.api.setAgentSystem(this.sysPrompt); this.sysCustom.set(true); this.toast.ok('system prompt saved'); }
  async resetSys() { const r = await this.api.resetAgentSystem(); this.sysPrompt = r.prompt; this.sysCustom.set(false); this.toast.ok('reset to default'); }
  async addKb() { await this.api.addKnowledge({ title: this.kbTitle.trim(), content: this.kbContent.trim() }); this.kbTitle = ''; this.kbContent = ''; this.knowledge.set(await this.api.knowledge()); this.toast.ok('note added'); }
  async delKb(n: KnowledgeNote) { await this.api.deleteKnowledge(n.id); this.knowledge.set(await this.api.knowledge()); }
  async saveDoc(d: AgentDoc) { await this.api.saveDoc(d.name, d.content); this.docs.set(await this.api.agentDocs()); this.toast.ok('doc saved'); }
  async resetDoc(d: AgentDoc) { await this.api.resetDoc(d.name); this.docs.set(await this.api.agentDocs()); this.toast.ok('reset to default'); }
  async resetAllDocs() { await this.api.resetDocs(); this.docs.set(await this.api.agentDocs()); this.toast.ok('all docs reset to default'); }
}
