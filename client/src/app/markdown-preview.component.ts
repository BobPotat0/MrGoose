import { Component, Input, OnChanges, ViewEncapsulation } from '@angular/core';
import { Marked, type Tokens } from 'marked';

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const parser = new Marked({
  gfm: true,
  renderer: {
    // Research/payload files may contain HTML. Display it literally, never execute it.
    html({ text }: Tokens.HTML | Tokens.Tag) { return escapeHtml(text); },
    image({ text }: Tokens.Image) { return `<span>${escapeHtml(text || 'Image')}</span>`; },
    link(this: { parser: { parseInline(tokens: Tokens.Link['tokens']): string } }, { href, tokens }: Tokens.Link) {
      const label = this.parser.parseInline(tokens);
      try {
        const url = new URL(href);
        if (url.protocol === 'https:' || url.protocol === 'http:')
          return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      } catch { /* unsupported/relative destinations are rendered as labels */ }
      return label;
    },
  },
});

@Component({
  selector: 'mg-markdown-preview',
  template: '<div class="mg-file-markdown" [innerHTML]="html" aria-label="Formatted Markdown preview"></div>',
  styleUrl: './markdown-preview.component.css',
  // The HTML is generated, so styles are namespaced instead of relying on emulated child attributes.
  encapsulation: ViewEncapsulation.None,
})
export class MarkdownPreviewComponent implements OnChanges {
  @Input() content = '';
  html = '';
  ngOnChanges() { this.html = parser.parse(this.content, { async: false }); }
}
