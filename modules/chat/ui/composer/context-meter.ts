import { Component, computed, inject, input } from '@angular/core';
import type { ContextUsage } from '@grimoire/contract';
import { tokenCount } from '@ui/app/core/tokens';
import { Wording } from '@ui/app/core/wording';

/**
 * How full the chat's context window is: the chat's page allowance. It
 * fills toward where the agent compacts the chat by itself, or toward
 * the window's end when it doesn't.
 */
@Component({
  selector: 'gr-context-meter',
  templateUrl: './context-meter.html',
  styleUrl: './context-meter.css',
  host: {
    role: 'meter',
    'aria-label': 'Context window used',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'share()',
    '[attr.title]': 'detail()',
  },
})
export class ContextMeter {
  protected readonly wording = inject(Wording);

  readonly context = input.required<ContextUsage>();

  /** Where the meter ends: the compaction, else the window's end. */
  protected readonly range = computed(() => this.context().compactsAt ?? this.context().limit);

  /** The share of the range used, in percent. */
  protected readonly share = computed(() => Math.round((this.context().used / this.range()) * 100));

  protected readonly count = computed(
    () => `${tokenCount(this.context().used)} / ${tokenCount(this.range())}`,
  );

  protected readonly detail = computed(() => {
    const { used, limit, compactsAt } = this.context();
    const filled = `${used.toLocaleString()} of ${limit.toLocaleString()} tokens`;
    return compactsAt ? `${filled}; compacts at ${compactsAt.toLocaleString()}` : filled;
  });
}
