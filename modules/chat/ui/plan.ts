import { Component, computed, inject } from '@angular/core';
import type { PlanStep } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Wording } from '@ui/app/core/wording';

const NUMERALS = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];
const VALUES = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];

/** 4 as iv., the way a book numbers its outline. */
export function roman(n: number): string {
  let out = '';
  VALUES.forEach((value, i) => {
    for (; n >= value; n -= value) out += NUMERALS[i];
  });
  return `${out}.`;
}

// What the step being worked on says while the chat runs.
const RUNNING: Record<string, string> = {
  writing: 'writing',
  thinking: 'thinking',
  waiting: 'waiting for you',
};

/**
 * The right page's Plan: the open chat's plan, as the agent keeps
 * it up to date while it works. The step under way is set in bold.
 */
@Component({
  selector: 'gr-plan',
  imports: [Icon],
  templateUrl: './plan.html',
  styleUrl: './plan.css',
})
export class Plan {
  private readonly list = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);
  protected readonly wording = inject(Wording);
  protected readonly roman = roman;

  protected readonly chat = this.list.current;
  protected readonly agent = computed(() =>
    this.catalog.agentName(this.chat()?.agent ?? 'claude-code'),
  );
  protected readonly plan = computed<readonly PlanStep[]>(() => this.chat()?.plan ?? []);
  /** What the step under way says: the chat's status while it runs. */
  protected readonly underWay = computed(() => RUNNING[this.chat()?.status ?? ''] ?? 'under way');
}

/** The Plan's line in the page footer, such as "3 of 5 done". */
export function planFoot(list: ChatList): string {
  const plan = list.current()?.plan ?? [];
  return plan.length
    ? `${plan.filter((step) => step.status === 'done').length} of ${plan.length} done`
    : '';
}
