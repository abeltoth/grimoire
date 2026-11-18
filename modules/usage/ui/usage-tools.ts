import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, input, signal } from '@angular/core';
import { TokenReadings } from './token-readings';
import { UsageSpans } from './usage-spans';
import { againstMost, uses } from './usage-format';

const SHOWN = 5;

/** The Usage page's Tools & skills tab: the tools and skills used most over the span. */
@Component({
  selector: 'gr-usage-tools',
  imports: [NgTemplateOutlet, UsageSpans],
  templateUrl: './usage-tools.html',
  styleUrls: ['./usage-lists.css', './usage-sections.css'],
})
export class UsageTools {
  protected readonly readings = inject(TokenReadings);

  readonly shown = input.required<boolean>();

  /** How many rows a list shows before "Show all". */
  protected readonly few = SHOWN;
  private readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly uses = uses;
  protected readonly againstMost = againstMost;
  protected readonly round = Math.round;

  /** The first few of a list, or all of it once opened. */
  protected top<T>(list: readonly T[], key: string): readonly T[] {
    return this.open().has(key) ? list : list.slice(0, SHOWN);
  }

  protected isOpen(key: string): boolean {
    return this.open().has(key);
  }

  protected toggle(key: string): void {
    this.open.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
}
