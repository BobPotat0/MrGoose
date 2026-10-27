import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { BackendService } from './backend.service';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { UsageInfo } from './models';
import { OrganizerChatStore } from './organizer-chat.store';

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
  readonly chat = inject(OrganizerChatStore);
  readonly router = inject(Router);

  readonly needsKey = signal(false);
  readonly usage = signal<UsageInfo | null>(null);

  readonly workspaceNav = [
    { path: 'organizer', label: 'Mr Goose Organizer' },
    { path: 'workbench', label: 'Break Workbench' },
  ];
  readonly libraryNav = [
    { path: 'sources', label: 'Source Library' },
    { path: 'prompts', label: 'Prompt Library' },
    { path: 'techniques', label: 'Technique Library' },
    { path: 'challenges', label: 'Challenge Library' },
  ];

  openSession(id: string) {
    if (this.chat.streaming() || this.chat.uploading()) return;
    this.chat.selectChat(id);
    void this.router.navigate(['/organizer']);
  }

  newSession() {
    if (this.chat.streaming() || this.chat.uploading()) return;
    this.chat.newChat();
    void this.router.navigate(['/organizer']);
  }

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
  sessionDate(timestamp: string) { const date = new Date(timestamp); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  fmt(n: number | null | undefined) { return n == null ? '—' : '$' + n.toFixed(n < 1 ? 4 : 2); }
}
