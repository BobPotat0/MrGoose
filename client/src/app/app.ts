import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { BackendService } from './backend.service';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { UsageInfo } from './models';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly backend = inject(BackendService);
  readonly toast = inject(ToastService);
  private api = inject(ApiService);

  readonly needsKey = signal(false);
  readonly usage = signal<UsageInfo | null>(null);

  readonly nav = [
    { path: 'assistant', label: 'Mr Goose Agent' },
    { path: 'prompts', label: 'Prompt Library' },
    { path: 'techniques', label: 'Technique Library' },
    { path: 'challenges', label: 'Challenge Library' },
    { path: 'workbench', label: 'Break Workbench' },
    { path: 'settings', label: 'Settings' },
  ];

  constructor() {
    this.backend.init().then(() => this.refresh());
    setInterval(() => this.refresh(), 15000);   // re-check so the key banner / usage stay current
  }
  private async refresh() { await this.checkKey(); await this.loadUsage(); }
  private async checkKey() {
    try { this.needsKey.set(!(await this.api.settings()).hasKey); } catch { /* backend down */ }
  }
  private async loadUsage() {
    try { const u = await this.api.usage(); this.usage.set(u); this.needsKey.set(!u.hasKey); } catch { /* backend down */ }
  }
  fmt(n: number | null | undefined) { return n == null ? '—' : '$' + n.toFixed(n < 1 ? 4 : 2); }
}
