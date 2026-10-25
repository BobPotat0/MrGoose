import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; kind: 'ok' | 'err' | 'info'; text: string; }

/** Lightweight toast feed rendered by the shell. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  show(text: string, kind: Toast['kind'] = 'info', ms = 3500) {
    const id = ++this.seq;
    this.toasts.update(t => [...t, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
  ok(t: string) { this.show(t, 'ok'); }
  err(t: string) { this.show(t, 'err', 5500); }
  info(t: string) { this.show(t, 'info'); }
  dismiss(id: number) { this.toasts.update(t => t.filter(x => x.id !== id)); }
}
