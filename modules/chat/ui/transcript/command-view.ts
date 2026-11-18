import { Component, computed, inject, input, signal } from '@angular/core';
import { type CodeToken, Highlighter } from '../markdown/highlighter';
import { type Shell, commandParts } from './command-parts';

/** How many lines a command shows before Show all. */
const FOLD_LINES = 12;

interface Part {
  label?: string;
  lines: CodeToken[][];
}

/**
 * A command in full, coloured in its shell's language, each heredoc set
 * apart under what reads it and coloured in that language. A long one
 * shows its start, fading out, until you ask for all of it.
 */
@Component({
  selector: 'gr-command',
  templateUrl: './command-view.html',
  styleUrl: './command-view.css',
  host: { role: 'region', 'aria-label': 'Command' },
})
export class CommandView {
  private readonly highlighter = inject(Highlighter);

  readonly command = input.required<string>();
  readonly shell = input<Shell>('bash');

  protected readonly open = signal(false);

  protected readonly parts = computed<Part[]>(() => {
    const { command, scripts } = commandParts(this.command(), this.shell());
    return [
      { lines: this.colour(command, this.shell()) },
      ...scripts.map((script) => ({
        label: script.label,
        lines: this.colour(script.code, script.lang),
      })),
    ];
  });

  protected readonly count = computed(() =>
    this.parts().reduce((sum, part) => sum + part.lines.length + (part.label ? 1 : 0), 0),
  );
  protected readonly foldable = computed(() => this.count() > FOLD_LINES);

  /** The code's lines in colour once its language loads; a blank line keeps a space, to keep its height. */
  private colour(code: string, lang: string): CodeToken[][] {
    const lines =
      this.highlighter.lines(code, lang) ??
      code.split('\n').map((text) => [{ text, italic: false }]);
    return lines.map((line) => (line.some((t) => t.text) ? line : [{ text: ' ', italic: false }]));
  }
}
