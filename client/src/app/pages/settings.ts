import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';
import { KeyInfo, ModelInfo } from '../models';

@Component({
  selector: 'mg-settings',
  imports: [FormsModule],
  template: `
    <section class="page" style="max-width:760px">
      <header class="page-head">
        <span class="label-mono">Settings</span>
        <h1>Settings</h1>
        <p class="sub">OpenRouter powers the crafter/agent/judge only — victim responses always come from the real arena.</p>
      </header>

      @if (mcpAvailable) {
        <div class="card">
          <span class="label-mono">Local MCP</span>
          <p class="muted">Your external client supplies its model. MrGoose only reads data and fills fields; you verify the Arena model/scenario and launch manually.</p>
          <p class="muted">Run collection is not installed. Saved observations have unknown run identity and completion.</p>
          <p class="muted">Local access is automatic for your Windows user. No authorization or pairing step.</p>
          @if (mcpConfig()) { <details><summary>MCP client configuration</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">{{ mcpConfig() }}</pre></details> }
          <details style="margin-top:12px"><summary>Operator-approved Arena field profiles</summary>
            <p class="muted">Advanced: save a profile JSON with id, challengeSlug, url, fields (field name to CSS selector), resultSelector. Agents can discover and bind fields directly through MCP. Custom model/scenario controls remain manual.</p>
            <textarea class="textarea" style="min-height:160px" [(ngModel)]="mcpProfile" placeholder="Profile JSON"></textarea>
            <button class="btn" (click)="saveMcpProfile()">save approved profile</button>
            <pre style="white-space:pre-wrap;overflow-wrap:anywhere">{{ mcpProfiles() }}</pre>
          </details>
        </div>
      }

      <!-- OpenRouter keys (multiple, DPAPI-encrypted) -->
      <div class="card">
        <span class="label-mono">OpenRouter keys</span>
        <p class="muted" style="font-size:12px;margin:6px 0">Stored locally, encrypted at rest with Windows DPAPI (never returned in full). Add several and pick the active one.</p>
        @for (k of keys(); track k.id) {
          <div class="card" style="margin-top:8px;padding:9px 11px"><div class="row spread">
            <div class="row"><strong style="font-size:13px">{{ k.name }}</strong><span class="mono dim" style="font-size:12px">{{ k.last4 }}</span>@if (k.active) { <span class="chip lime">active</span> }</div>
            <div class="row">@if (!k.active) { <button class="btn" (click)="activate(k)">use</button> }<button class="btn danger" (click)="delKey(k)">delete</button></div>
          </div></div>
        }
        @if (!keys().length) { <p class="muted" style="font-size:12px;margin-top:6px">No keys yet — add one below.</p> }
        <div class="row" style="margin-top:10px"><input class="input" style="max-width:150px" [(ngModel)]="newKeyName" placeholder="name (e.g. main)" /><input class="input grow" type="password" [(ngModel)]="newKeyValue" placeholder="sk-or-…" /><button class="btn primary" (click)="addKey()" [disabled]="!newKeyValue.trim()">+ add key</button></div>
      </div>

      <!-- model picker with search -->
      <div class="card">
        <span class="label-mono">Model</span>
        <p class="muted" style="font-size:12px;margin:6px 0">Current: <span class="mono">{{ model || '(none)' }}</span></p>
        <div class="row"><input class="input grow" [(ngModel)]="modelQuery" (ngModelChange)="searchModels()" placeholder="search models… e.g. claude, gpt, llama, free" /><button class="btn" (click)="searchModels()">search</button></div>
        @if (searching()) { <p class="muted" style="font-size:11px;margin-top:6px">searching…</p> }
        @if (modelResults().length) {
          <div style="max-height:320px;overflow-y:auto;margin-top:8px">
            @for (m of modelResults(); track m.id) {
              <div class="card" style="margin-top:6px;padding:8px 10px;cursor:pointer" [style.border-color]="m.id===model ? 'var(--lime)' : ''" (click)="selectModel(m)">
                <div class="row spread"><span class="mono" style="font-size:12.5px" [style.color]="m.id===model ? 'var(--lime)' : 'var(--text)'">{{ m.id }}</span>@if (m.id===model) { <span class="chip lime">selected</span> }</div>
                <div class="muted" style="font-size:11px;margin-top:2px">{{ m.name }}@if (m.prompt) { <span class="mono"> · in {{ m.prompt }}/tok · out {{ m.completion }}/tok</span> }</div>
              </div>
            }
          </div>
        } @else if (modelQuery && !searching()) { <p class="muted" style="font-size:12px;margin-top:6px">no matches</p> }
        <div class="row" style="margin-top:10px"><input class="input grow" [(ngModel)]="model" placeholder="or type a model id" /><button class="btn primary" (click)="saveModel()">save model</button></div>
      </div>

      <div class="card">
        <span class="label-mono">Arena</span>
        <p class="muted" style="font-size:12px;margin:6px 0">Default URL opened in a new arena tab.</p>
        <input class="input" [(ngModel)]="arenaUrl" placeholder="https://app.grayswan.ai/arena/challenge/…" />
        <div class="row" style="margin-top:10px"><button class="btn primary" (click)="saveArena()">save</button></div>
      </div>
    </section>
  `,
})
export class SettingsPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  readonly keys = signal<KeyInfo[]>([]);
  readonly modelResults = signal<ModelInfo[]>([]);
  readonly searching = signal(false);
  readonly mcpAvailable = !!window.mrgoose?.mcp;
  readonly mcpConfig = signal('');
  readonly mcpProfiles = signal('');
  mcpProfile = '';
  model = ''; arenaUrl = '';
  newKeyName = ''; newKeyValue = ''; modelQuery = '';
  private searchTimer: any;

  constructor() { this.load(); }
  async load() {
    const s = await this.api.settings();
    this.model = s.model; this.arenaUrl = s.arenaUrl;
    this.keys.set(await this.api.keys());
    await this.loadMcp();
  }
  async loadMcp() { const state = await window.mrgoose?.mcp?.status(); if (state) { this.mcpConfig.set(JSON.stringify({ command: state.command, args: state.args, env: state.env }, null, 2)); this.mcpProfiles.set(JSON.stringify(state.profiles, null, 2)); } }
  async saveMcpProfile() { try { await window.mrgoose?.mcp?.saveProfile(JSON.parse(this.mcpProfile)); await this.loadMcp(); this.toast.ok('profile saved'); } catch { this.toast.err('Invalid profile or unsupported Arena URL'); } }

  async addKey() { if (!this.newKeyValue.trim()) return; await this.api.addKey(this.newKeyName.trim() || 'key', this.newKeyValue.trim()); this.newKeyName = ''; this.newKeyValue = ''; this.keys.set(await this.api.keys()); this.toast.ok('key added (encrypted)'); }
  async activate(k: KeyInfo) { await this.api.activateKey(k.id); this.keys.set(await this.api.keys()); this.toast.ok(`active key → ${k.name}`); }
  async delKey(k: KeyInfo) { await this.api.deleteKey(k.id); this.keys.set(await this.api.keys()); this.toast.ok('key deleted'); }

  searchModels() {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(async () => {
      this.searching.set(true);
      try { this.modelResults.set(await this.api.models(this.modelQuery.trim())); } catch { this.modelResults.set([]); }
      this.searching.set(false);
    }, 250);
  }
  selectModel(m: ModelInfo) { this.model = m.id; }
  async saveModel() { await this.api.setSetting('openrouter.model', this.model.trim()); this.toast.ok('model saved'); }
  async saveArena() { await this.api.setSetting('arena.url', this.arenaUrl.trim()); this.toast.ok('arena URL saved'); }
}
