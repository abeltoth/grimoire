import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { DiffLine } from './diff';

interface Line extends DiffLine {
  key: number;
  /** The correction mark in the margin. */
  mark: string;
}

/**
 * A fold-out with a file's corrections, marked the way a proofreader would:
 * removed lines struck through, inserted lines with a caret.
 */
@Component({
  selector: 'gr-corrections',
  templateUrl: './corrections.html',
  styleUrl: './corrections.css',
  host: { role: 'region', '[attr.aria-label]': "'Corrections to ' + file()" },
})
export class Corrections {
  readonly file = input.required<string>();
  readonly lines = input.required<readonly DiffLine[]>();
  /** Who marked them, such as "as proposed by Claude Code". */
  readonly caption = input.required<string>();

  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');

  protected readonly marked = computed<Line[]>(() =>
    this.lines().map((line, key, lines) => ({ ...line, key, mark: markOf(lines, key) })),
  );
  protected readonly inserted = computed(
    () => this.lines().filter((line) => line.kind === 'inserted').length,
  );
  protected readonly removed = computed(
    () => this.lines().filter((line) => line.kind === 'removed').length,
  );
  /** How many lines fit before you scroll; all of them when they all fit. */
  protected readonly shown = signal(0);

  constructor() {
    afterRenderEffect(() => {
      const total = this.lines().length;
      const { clientHeight, scrollHeight } = this.body().nativeElement;
      this.shown.set(
        scrollHeight > clientHeight && total
          ? Math.floor(clientHeight / (scrollHeight / total))
          : total,
      );
    });
  }
}

function markOf(lines: readonly DiffLine[], index: number): string {
  const line = lines[index]!;
  if (line.kind === 'removed') return 'dele';
  if (line.kind !== 'inserted' || lines[index - 1]?.kind === 'inserted') return '';
  let run = 1;
  while (lines[index + run]?.kind === 'inserted') run++;
  return run === 1 ? '‸ insert' : `‸ insert ${run} lines`;
}
