import { Component, ElementRef, computed, input, output, viewChild } from '@angular/core';
import type { DiffLine } from '@grimoire/contract';
import { linesShown } from './fold-out';

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
  styleUrl: './fold-out.css',
  host: { role: 'region', '[attr.aria-label]': "'Corrections to ' + file()" },
})
export class Corrections {
  readonly file = input.required<string>();
  readonly lines = input.required<readonly DiffLine[]>();
  /** Who marked them, such as "as proposed by Claude Code". */
  readonly caption = input.required<string>();
  /** Whether it offers to open the file in Files. */
  readonly openable = input(false);
  /** Asks to open the file in Files. */
  readonly open = output<void>();

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
  protected readonly shown = linesShown(
    () => this.body().nativeElement,
    () => this.lines().length,
  );
}

function markOf(lines: readonly DiffLine[], index: number): string {
  const line = lines[index]!;
  if (line.kind === 'removed') return 'dele';
  if (line.kind !== 'inserted' || lines[index - 1]?.kind === 'inserted') return '';
  let run = 1;
  while (lines[index + run]?.kind === 'inserted') run++;
  return run === 1 ? '‸ insert' : `‸ insert ${run} lines`;
}
