import { Component, computed, inject } from '@angular/core';
import type { PlanStep } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { Chats } from '@ui/app/core/chats';
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

// What the step being worked on says while the chapter runs.
const RUNNING: Record<string, string> = {
  writing: 'writing',
  thinking: 'thinking',
  waiting: 'waiting for you',
};

/**
 * The facing page's Outline: the open chapter's plan, as the agent keeps
 * it up to date while it works. The step under way is set in bold.
 */
@Component({
  selector: 'gr-outline',
  imports: [Icon],
  templateUrl: './outline.html',
  styleUrl: './outline.css',
})
export class Outline {
  private readonly chats = inject(Chats);
  protected readonly wording = inject(Wording);
  protected readonly roman = roman;

  protected readonly chapter = this.chats.current;
  protected readonly agent = computed(() =>
    this.chats.agentName(this.chapter()?.agent ?? 'claude-code'),
  );
  protected readonly plan = computed<readonly PlanStep[]>(() => this.chapter()?.plan ?? []);
  /** What the step under way says: the chapter's status while it runs. */
  protected readonly underWay = computed(() => RUNNING[this.chapter()?.status ?? ''] ?? 'under way');
}

/** The Outline's line in the running foot, such as "3 of 5 done". */
export function outlineFoot(chats: Chats): string {
  const plan = chats.current()?.plan ?? [];
  return plan.length ? `${plan.filter((step) => step.status === 'done').length} of ${plan.length} done` : '';
}
