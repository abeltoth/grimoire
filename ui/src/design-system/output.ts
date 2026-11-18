import { Component, computed, input } from '@angular/core';

/** Terminal colour and cursor codes, which a page can't show. */
const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * An expandable with what a tool printed, such as a command's output. The
 * command, given with class `command`, goes above it; anything else given
 * goes in its body, before what it printed.
 */
@Component({
  selector: 'gr-output',
  templateUrl: './output.html',
  styleUrl: './expandable.css',
  host: { role: 'region', '[attr.aria-label]': "'Output of ' + title()" },
})
export class Output {
  /** What printed it, such as the command or what the command does. */
  readonly title = input.required<string>();
  readonly text = input.required<string>();
  /** The tool still runs: `text` is what it was asked, and its output is still to come. */
  readonly running = input(false);

  protected readonly lines = computed(() =>
    this.running() && !this.text()
      ? []
      : this.text()
          .replace(ESCAPES, '')
          .replace(/\r?\n$/, '')
          .split(/\r?\n/),
  );
}
