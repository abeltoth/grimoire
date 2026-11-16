import { NgTemplateOutlet } from '@angular/common';
import { Component, type TemplateRef, computed, inject, input } from '@angular/core';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { Diagram } from './diagram';
import { type FilePlace, fileOfCode, fileOfLink } from './file-links';
import { Listing } from './listing';
import { parseMarkdown } from './markdown';

/**
 * A reply's markdown, set as the page's text: paragraphs, lists, quotes,
 * tables and numbered code listings, Mermaid ones drawn as diagrams.
 * Rendered from tokens through templates, never as HTML; a diagram is
 * the SVG Mermaid draws. A link or code that names a file opens it in
 * Files, at its line if it names one. `tail` (the quill and Stop) follows
 * the last words while the agent writes.
 */
@Component({
  selector: 'gr-markdown',
  imports: [Diagram, Listing, NgTemplateOutlet],
  templateUrl: './markdown-view.html',
  styleUrl: './markdown-view.css',
})
export class MarkdownView {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly shell = inject(ShellRegistry);

  readonly text = input.required<string>();
  /** Still being written: half-finished markdown is closed as it will be. */
  readonly writing = input(false);
  /** The number of the reply's first listing in the chat. */
  readonly firstListing = input(1);
  readonly tail = input<TemplateRef<unknown> | null>(null);

  protected readonly markdown = computed(() => parseMarkdown(this.text(), this.writing()));

  /** The window never navigates away from the app: a link to a file opens in Files, any other in your browser. */
  protected follow(event: MouseEvent, href: string): void {
    event.preventDefault();
    const place = fileOfLink(href);
    if (!place) this.bridge.openExternal(href);
    else this.shell.openFile()?.(place.path, place.line);
  }

  /** The file code names, when Files can open it. */
  protected fileIn(code: string): FilePlace | undefined {
    return this.shell.openFile() ? fileOfCode(code) : undefined;
  }

  protected open(event: MouseEvent, place: FilePlace): void {
    event.preventDefault();
    this.shell.openFile()?.(place.path, place.line);
  }
}
