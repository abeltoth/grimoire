import { Component, computed, input } from '@angular/core';

/** Terminal colour and cursor codes, which a page can't show. */
const ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** A fold-out with what a tool printed, such as a command's output. */
@Component({
  selector: 'gr-output',
  templateUrl: './output.html',
  styleUrl: './fold-out.css',
  host: { role: 'region', '[attr.aria-label]': "'Output of ' + title()" },
})
export class Output {
  /** What printed it, such as the command or what the command does. */
  readonly title = input.required<string>();
  readonly text = input.required<string>();
  /** The command in full, set above its output, when the title doesn't show it all. */
  readonly command = input('');

  protected readonly commandLines = computed(() => (this.command() ? this.command().split(/\r?\n/) : []));
  protected readonly lines = computed(() =>
    this.text().replace(ESCAPES, '').replace(/\r?\n$/, '').split(/\r?\n/),
  );
}
