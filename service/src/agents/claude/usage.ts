import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { PlanUsage, UsageCredits, UsageWindow } from '@grimoire/contract';

type Limit = { utilization: number | null; resets_at: string | null } | null | undefined;

type Credits = NonNullable<NonNullable<SDKControlGetUsageResponse['rate_limits']>['extra_usage']>;

/** Usage credits as /usage shows them, while they're turned on. */
function toCredits(credits: Credits | null | undefined, at: number): UsageCredits | undefined {
  if (!credits?.is_enabled) return undefined;
  const { monthly_limit: limit, used_credits: spent } = credits;
  const used =
    credits.utilization ??
    (limit && spent !== null ? Math.min(Math.max((spent / limit) * 100, 0), 100) : null);
  const now = new Date(at);
  return {
    spent,
    limit,
    currency: credits.currency?.toUpperCase() || 'USD',
    used: limit === null ? null : used,
    resetsAt: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
  };
}

/**
 * What Claude Code's /usage shows of the Claude subscription: the five-hour
 * session, the week, any week kept for one model, and usage credits while
 * they're turned on.
 */
export function toPlanUsage(usage: SDKControlGetUsageResponse, at: number): PlanUsage {
  const limits = usage.rate_limits;
  const windows: UsageWindow[] = [];
  const add = (span: UsageWindow['span'], limit: Limit, model?: string) => {
    if (!limit || windows.some((window) => window.span === span && window.model === model)) return;
    windows.push({
      span,
      ...(model ? { model } : {}),
      used: limit.utilization,
      resetsAt: limit.resets_at ? Date.parse(limit.resets_at) : null,
    });
  };
  if (limits) {
    add('session', limits.five_hour);
    add('week', limits.seven_day);
    add('week', limits.seven_day_opus, 'Opus');
    add('week', limits.seven_day_sonnet, 'Sonnet');
    for (const scoped of limits.model_scoped ?? []) add('week', scoped, scoped.display_name);
  }
  const credits = toCredits(limits?.extra_usage, at);
  return { plan: usage.subscription_type, windows, ...(credits ? { credits } : {}), at };
}
