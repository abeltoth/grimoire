import { Component, computed, input, output } from '@angular/core';
import type { DiffLine } from '@grimoire/contract';

interface Line extends DiffLine {
  key: number;
  /** It begins another edit, when several are stacked. */
  break: boolean;
}

/** An expandable with a file's diff: removed lines struck through and signed −, inserted ones signed +. */
@Component({
  selector: 'gr-diff-view',
  templateUrl: './diff-view.html',
  styleUrl: './expandable.css',
  host: { role: 'region', '[attr.aria-label]': "'Corrections to ' + file()" },
})
export class DiffView {
  readonly file = input.required<string>();
  readonly lines = input.required<readonly DiffLine[]>();
  /** Where each stacked edit after the first begins, as line indexes. */
  readonly breaks = input<readonly number[]>([]);
  /** Whether it offers to open the file in Files. */
  readonly openable = input(false);
  /** Asks to open the file in Files. */
  readonly open = output<void>();

  protected readonly sign: Record<DiffLine['kind'], string> = {
    same: '',
    removed: '−',
    inserted: '+',
  };
  protected readonly marked = computed<Line[]>(() => {
    const breaks = new Set(this.breaks());
    return this.lines().map((line, key) => ({ ...line, key, break: breaks.has(key) }));
  });
  protected readonly inserted = computed(
    () => this.lines().filter((line) => line.kind === 'inserted').length,
  );
  protected readonly removed = computed(
    () => this.lines().filter((line) => line.kind === 'removed').length,
  );
}
