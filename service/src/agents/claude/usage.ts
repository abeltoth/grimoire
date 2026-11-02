import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { PlanUsage, UsageWindow } from '@grimoire/contract';

type Limit = { utilization: number | null; resets_at: string | null } | null | undefined;

/**
 * What Claude Code's /usage shows of the Claude subscription: the five-hour
 * session, the week, and any week kept for one model. Extra usage counts
 * only when it's turned on.
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
  return {
    plan: usage.subscription_type,
    windows,
    ...(limits?.extra_usage?.is_enabled ? { extra: limits.extra_usage.utilization } : {}),
    at,
  };
}
