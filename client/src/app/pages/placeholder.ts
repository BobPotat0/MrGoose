import { Component, Input } from '@angular/core';

/**
 * P0 stub page. One component rendered for every nav route; route `data` flows in via
 * withComponentInputBinding(). Each of these becomes a real feature in a later phase.
 */
@Component({
  selector: 'mg-placeholder',
  template: `
    <section class="page">
      <header class="page-head">
        <span class="label-mono">Mr Goose</span>
        <h1>{{ title }}</h1>
        <p class="page-sub">{{ subtitle }}</p>
      </header>

      <div class="phase-card">
        <span class="phase-badge mono">{{ phase }}</span>
        <p class="phase-note">{{ note }}</p>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 28px 30px; max-width: 920px; }
    .page-head { margin-bottom: 22px; }
    .page-head h1 { font-size: 26px; margin-top: 6px; }
    .page-sub { color: var(--text-dim); margin-top: 8px; font-size: 14px; line-height: 1.5; max-width: 60ch; }
    .phase-card {
      display: flex; align-items: center; gap: 14px;
      background: var(--surface); border: 1px solid var(--border);
      border-left: 3px solid var(--lime);
      border-radius: var(--radius-lg); padding: 16px 18px;
    }
    .phase-badge {
      flex: none; font-size: 12px; font-weight: 700; letter-spacing: 0.06em;
      color: #0a0a0b; background: var(--lime);
      padding: 4px 9px; border-radius: 5px;
    }
    .phase-note { color: var(--text-dim); font-size: 13.5px; }
  `],
})
export class PlaceholderPage {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() phase = '';
  @Input() note = 'Scaffolded in P0 — real functionality lands in a later phase.';
}
