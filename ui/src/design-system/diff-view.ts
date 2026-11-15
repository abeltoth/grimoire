import { Component, computed, input, output } from '@angular/core';
import type { DiffLine } from '@grimoire/contract';

/** A diff's line, with its number in the file when that's known. */
export interface NumberedLine extends DiffLine {
  at?: number;
}

interface Line extends NumberedLine {
  key: number;
  /** It begins another edit, when several are stacked. */
  break: boolean;
}

/**
 * An expandable with a file's diff: removed lines struck through and signed
 * −, inserted ones in green and signed +, the lines around them dimmed.
 */
@Component({
  selector: 'gr-diff-view',
  templateUrl: './diff-view.html',
  styleUrl: './expandable.css',
  host: { role: 'region', '[attr.aria-label]': "'Corrections to ' + file()" },
})
export class DiffView {
  readonly file = input.required<string>();
  readonly lines = input.required<readonly NumberedLine[]>();
  /** Where each stacked edit after the first begins, as line indexes. */
  readonly breaks = input<readonly number[]>([]);
  /** Whether it offers to open the file in Files. */
  readonly openable = input(false);
  /** Asks to open the file in Files. */
  readonly open = output<void>();
  /** Whether it offers to be put away. */
  readonly closable = input(false);
  /** Asks to be put away. */
  readonly hide = output<void>();

  protected readonly sign: Record<DiffLine['kind'], string> = {
    same: '',
    removed: '−',
    inserted: '+',
  };
  protected readonly marked = computed<Line[]>(() => {
    const breaks = new Set(this.breaks());
    return this.lines().map((line, key) => ({ ...line, key, break: breaks.has(key) }));
  });
  /** How many digits the widest line number has; 0 when the lines aren't numbered. */
  protected readonly digits = computed(() =>
    Math.max(
      0,
      ...this.lines().map((line) => (line.at === undefined ? 0 : String(line.at).length)),
    ),
  );
  protected readonly inserted = computed(
    () => this.lines().filter((line) => line.kind === 'inserted').length,
  );
  protected readonly removed = computed(
    () => this.lines().filter((line) => line.kind === 'removed').length,
  );
}
