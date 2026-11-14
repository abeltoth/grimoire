import { Component, computed, inject, input, signal } from '@angular/core';
import type { AgentId, ContextUsage } from '@grimoire/contract';
import { tokenCount } from '@ui/app/core/tokens';
import { Wording } from '@ui/app/core/wording';
import { CompactionCard } from './compaction-card';

/**
 * How full the chat's context window is: the chat's page allowance. It
 * fills toward where the agent compacts the chat by itself, or toward
 * the window's end when it doesn't. A click opens how the agent compacts
 * the chat's model, to change it.
 */
@Component({
  selector: 'gr-context-meter',
  imports: [CompactionCard],
  templateUrl: './context-meter.html',
  styleUrl: './context-meter.css',
})
export class ContextMeter {
  protected readonly wording = inject(Wording);

  readonly chatId = input.required<string>();
  readonly agent = input.required<AgentId>();
  readonly context = input.required<ContextUsage>();

  /** Whether how the agent compacts is open over it. */
  protected readonly open = signal(false);

  /** Where the meter ends: the compaction, else the window's end. */
  protected readonly range = computed(() => this.context().compactsAt ?? this.context().limit);

  /** The share of the range used, in percent. */
  protected readonly share = computed(() => Math.round((this.context().used / this.range()) * 100));

  protected readonly count = computed(
    () => `${tokenCount(this.context().used)} / ${tokenCount(this.range())}`,
  );

  protected readonly label = computed(
    () => `Context window: ${this.share()}% used, ${this.count()}. Change how it compacts`,
  );

  protected readonly detail = computed(() => {
    const { used, limit, compactsAt } = this.context();
    const filled = `${used.toLocaleString()} of ${limit.toLocaleString()} tokens`;
    return compactsAt ? `${filled}; compacts at ${compactsAt.toLocaleString()}` : filled;
  });
}
