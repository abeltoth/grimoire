import { Component, computed, input, output } from '@angular/core';
import type { DiffLine } from '@grimoire/contract';

interface Line extends DiffLine {
  key: number;
  /** The correction mark in the margin. */
  mark: string;
  /** It begins another edit, when several are stacked. */
  break: boolean;
}

/**
 * A fold-out with a file's corrections, marked the way a proofreader would:
 * removed lines struck through, inserted lines with a caret.
 */
@Component({
  selector: 'gr-corrections',
  templateUrl: './corrections.html',
  styleUrl: './fold-out.css',
  host: { role: 'region', '[attr.aria-label]': "'Corrections to ' + file()" },
})
export class Corrections {
  readonly file = input.required<string>();
  readonly lines = input.required<readonly DiffLine[]>();
  /** Where each stacked edit after the first begins, as line indexes. */
  readonly breaks = input<readonly number[]>([]);
  /** Who marked them, such as "as proposed by Claude Code". */
  readonly caption = input.required<string>();
  /** Whether it offers to open the file in Files. */
  readonly openable = input(false);
  /** Asks to open the file in Files. */
  readonly open = output<void>();

  protected readonly marked = computed<Line[]>(() => {
    const breaks = new Set(this.breaks());
    return this.lines().map((line, key, lines) => ({
      ...line,
      key,
      mark: markOf(lines, key, breaks),
      break: breaks.has(key),
    }));
  });
  protected readonly inserted = computed(
    () => this.lines().filter((line) => line.kind === 'inserted').length,
  );
  protected readonly removed = computed(
    () => this.lines().filter((line) => line.kind === 'removed').length,
  );
}

/** A run of inserted lines is marked once, and doesn't run on into the next stacked edit. */
function markOf(lines: readonly DiffLine[], index: number, breaks: ReadonlySet<number>): string {
  const line = lines[index]!;
  if (line.kind === 'removed') return 'dele';
  if (line.kind !== 'inserted' || (!breaks.has(index) && lines[index - 1]?.kind === 'inserted')) return '';
  let run = 1;
  while (lines[index + run]?.kind === 'inserted' && !breaks.has(index + run)) run++;
  return run === 1 ? '‸ insert' : `‸ insert ${run} lines`;
}
