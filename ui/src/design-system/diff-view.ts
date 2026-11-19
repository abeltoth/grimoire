import { Component, computed, input, output } from '@angular/core';
import type { DiffLine } from '@grimoire/contract';
import { wordDiff, type WordPart } from './word-diff';

/** A diff's line, with its number in the file when that's known. */
export interface NumberedLine extends DiffLine {
  at?: number;
}

interface Line extends NumberedLine {
  key: number;
  /** It begins another edit, when several are stacked. */
  break: boolean;
  /** The line in runs, what changed set apart, when it pairs with a version on the other side. */
  parts?: WordPart[];
}

// How many inserted lines ahead a removed line looks for its new version.
const PAIR_REACH = 8;

/**
 * An expandable with a file's diff: removed lines struck through and signed
 * −, inserted ones in green and signed +, the lines around them dimmed; where
 * a line was edited rather than replaced, only the words that changed are marked.
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
    const lines: Line[] = this.lines().map((line, key) => ({
      ...line,
      key,
      break: breaks.has(key),
    }));
    pairEdits(lines);
    return lines;
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

/** Gives each removed line that was edited, and its new version, their words that changed. */
function pairEdits(lines: Line[]): void {
  let i = 0;
  while (i < lines.length) {
    const removedFrom = i;
    while (i < lines.length && lines[i]!.kind === 'removed') i++;
    const insertedFrom = i;
    while (i < lines.length && lines[i]!.kind === 'inserted') i++;
    if (removedFrom === insertedFrom) {
      i++;
      continue;
    }
    // Each removed line takes the likest inserted line after the last one taken, so new lines between edits don't throw the pairing off.
    let next = insertedFrom;
    for (let r = removedFrom; r < insertedFrom && next < i; r++) {
      let best: { at: number; diff: NonNullable<ReturnType<typeof wordDiff>> } | undefined;
      for (let k = next; k < Math.min(i, next + PAIR_REACH); k++) {
        const diff = wordDiff(lines[r]!.text, lines[k]!.text);
        if (diff && (!best || diff.likeness > best.diff.likeness)) best = { at: k, diff };
      }
      if (!best) continue;
      lines[r]!.parts = best.diff.before;
      lines[best.at]!.parts = best.diff.after;
      next = best.at + 1;
    }
  }
}
