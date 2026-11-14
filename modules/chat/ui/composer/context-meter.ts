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

  /** Why the window can't be changed here, when something Grimoire can't change sets it. */
  private readonly why = computed(() => {
    const fixed = this.context().fixed;
    return fixed ? `Set by ${fixed}, so it can’t be changed here` : '';
  });

  protected readonly label = computed(
    () =>
      `Context window: ${this.share()}% used, ${this.count()}. ` +
      (this.why() || 'Change how it compacts'),
  );

  protected readonly detail = computed(() => {
    const { used, limit, compactsAt } = this.context();
    const filled = `${used.toLocaleString()} of ${limit.toLocaleString()} tokens`;
    const measured = compactsAt ? `${filled}; compacts at ${compactsAt.toLocaleString()}` : filled;
    return this.why() ? `${measured}\n${this.why()}` : measured;
  });
}
