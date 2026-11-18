import type { PlanStep } from '@grimoire/contract';

/** The Plan's line in the page footer, such as "3 of 5 done". */
export function planFoot(plan: readonly PlanStep[]): string {
  return plan.length
    ? `${plan.filter((step) => step.status === 'done').length} of ${plan.length} done`
    : '';
}
