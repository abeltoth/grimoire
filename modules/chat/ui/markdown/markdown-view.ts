import { NgTemplateOutlet } from '@angular/common';
import { Component, type TemplateRef, computed, input } from '@angular/core';
import { Diagram } from './diagram';
import { Listing } from './listing';
import { parseMarkdown } from './markdown';

/**
 * A reply's markdown, set as the page's text: paragraphs, lists, quotes,
 * tables and numbered code listings, Mermaid ones drawn as diagrams.
 * Rendered from tokens through templates, never as HTML; a diagram is
 * the SVG Mermaid draws. `tail` (the quill and Stop) follows the last
 * words while the agent writes.
 */
@Component({
  selector: 'gr-markdown',
  imports: [Diagram, Listing, NgTemplateOutlet],
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.css',
})
export class MarkdownView {
  readonly text = input.required<string>();
  /** Still being written: half-finished markdown is closed as it will be. */
  readonly writing = input(false);
  /** The number of the reply's first listing in the chapter. */
  readonly firstListing = input(1);
  readonly tail = input<TemplateRef<unknown> | null>(null);

  protected readonly markdown = computed(() => parseMarkdown(this.text(), this.writing()));
}
