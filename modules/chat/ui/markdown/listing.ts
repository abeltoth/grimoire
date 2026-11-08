import { NgTemplateOutlet } from '@angular/common';
import { Component, type TemplateRef, computed, inject, input } from '@angular/core';
import { type CodeToken, Highlighter } from './highlighter';

/**
 * A code listing, numbered like a figure: its lines numbered, coloured
 * once Shiki has the language. While it's still being written, its foot
 * stays open and `tail` (the quill) follows the last line. What's put
 * inside it goes at the end of its caption.
 */
@Component({
  selector: 'gr-listing',
  imports: [NgTemplateOutlet],
  templateUrl: './listing.html',
  styleUrl: './listing.css',
})
export class Listing {
  private readonly highlighter = inject(Highlighter);

  readonly code = input.required<string>();
  readonly lang = input('');
  readonly number = input.required<number>();
  /** The closing fence hasn't come yet. */
  readonly open = input(false);
  readonly tail = input<TemplateRef<unknown> | null>(null);

  protected readonly lines = computed<CodeToken[][]>(
    () =>
      this.highlighter.lines(this.code(), this.lang()) ??
      this.code()
        .split('\n')
        .map((text) => [{ text, italic: false }]),
  );
}
