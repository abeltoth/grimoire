import { Component, computed, input, signal } from '@angular/core';
import { MarkdownView } from '../markdown/markdown-view';
import { htmlSource } from './html-markdown';
import type { TextField, ToolField } from './tool-input';

/** How many lines, or characters, a long field shows before Show all. */
const FOLD_LINES = 10;
const FOLD_CHARS = 800;

/** How many items of a list show before Show all. */
const FOLD_ITEMS = 3;

type ShortField = { name: string; kind: 'short'; value: string };
type ListField = Extract<ToolField, { kind: 'list' }>;

/**
 * A tool's input, field by field: the short ones in a grid, each long one in
 * a block of its own, folded. Markdown reads as the page's text, and HTML as
 * its markdown, never as HTML, with its source a click away. A list of
 * objects reads item by item, and an object inside field by field.
 */
@Component({
  selector: 'gr-tool-input',
  imports: [MarkdownView],
  templateUrl: './tool-input-view.html',
  styleUrl: './tool-input-view.css',
})
export class ToolInputView {
  readonly fields = input.required<readonly ToolField[]>();

  protected readonly short = computed(() =>
    this.fields().filter((f): f is ShortField => f.kind === 'short'),
  );
  protected readonly long = computed(() => this.fields().filter((f) => f.kind !== 'short'));

  /** The HTML fields shown as their source, and the fields shown in full, by name. */
  protected readonly sources = signal<ReadonlySet<string>>(new Set());
  protected readonly opened = signal<ReadonlySet<string>>(new Set());

  /** The markdown to set as text, or undefined when the field shows as it is. */
  protected rendered(field: TextField): string | undefined {
    if (field.kind === 'markdown') return field.value;
    if (field.kind === 'html' && field.preview.trim() && !this.sources().has(field.name))
      return field.preview;
    return undefined;
  }

  protected plain(field: TextField): string {
    return field.kind === 'html' ? htmlSource(field.value) : field.value;
  }

  protected previewable(field: ToolField): boolean {
    return field.kind === 'html' && !!field.preview.trim();
  }

  protected foldable(field: TextField): boolean {
    const text = this.rendered(field) ?? this.plain(field);
    return text.split('\n').length > FOLD_LINES || text.length > FOLD_CHARS;
  }

  /** The items of a list that show: the first few, until you ask for all. */
  protected shownItems(field: ListField): ToolField[][] {
    return this.opened().has(field.name) ? field.items : field.items.slice(0, FOLD_ITEMS);
  }

  protected foldableList(field: ListField): boolean {
    return field.items.length > FOLD_ITEMS;
  }

  protected toggle(set: 'sources' | 'opened', name: string): void {
    this[set].update((names) => {
      const next = new Set(names);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  }
}
