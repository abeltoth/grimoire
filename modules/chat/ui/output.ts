import { Component, ElementRef, computed, input, viewChild } from '@angular/core';
import { linesShown } from './fold-out';

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
  /** What printed it, such as the command. */
  readonly title = input.required<string>();
  readonly text = input.required<string>();

  private readonly body = viewChild.required<ElementRef<HTMLElement>>('body');

  protected readonly lines = computed(() =>
    this.text().replace(ESCAPES, '').replace(/\r?\n$/, '').split(/\r?\n/),
  );
  protected readonly shown = linesShown(
    () => this.body().nativeElement,
    () => this.lines().length,
  );
}
