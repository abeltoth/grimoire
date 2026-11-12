import { Component, inject, input } from '@angular/core';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { MarkdownView } from '../markdown/markdown-view';
import type { WebSource } from './web-search';

/**
 * A web search, expanded of its note: what was asked, the pages found,
 * each opening in your browser, and what the agent made of them.
 */
@Component({
  selector: 'gr-web-results',
  imports: [MarkdownView],
  templateUrl: './web-results.html',
  styleUrl: './web-results.css',
  host: { role: 'region', '[attr.aria-label]': "'Web search for ' + query()" },
})
export class WebResults {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly query = input.required<string>();
  readonly sources = input.required<readonly WebSource[]>();
  readonly summary = input('');

  protected open(url: string): void {
    this.bridge.openExternal(url);
  }

  /** The site a page is on, without its "www.". */
  protected site(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
}
