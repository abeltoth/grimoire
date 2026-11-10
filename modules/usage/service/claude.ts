import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type {
  PlanUsage,
  UsageBreakdown,
  UsageCredits,
  UsageSpan,
  UsageWindow,
} from '@grimoire/contract';
import { probe } from '@grimoire/service/claude/probe';
import type { UsageSource } from './sources';

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

type Span = NonNullable<SDKControlGetUsageResponse['behaviors']>['day'];

/**
 * What Claude Code's own scan of its transcripts on this machine says took
 * a share of the plan's usage, as /usage shows it; null when it has none.
 */
export function toUsageBreakdown(
  usage: SDKControlGetUsageResponse,
  at: number,
): UsageBreakdown | null {
  const scan = usage.behaviors;
  return scan ? { day: toSpan(scan.day), week: toSpan(scan.week), at } : null;
}

function toSpan(span: Span): UsageSpan {
  const of = (kind: UsageSpan['sources'][number]['kind'], items: { name: string; pct: number }[]) =>
    items.map(({ name, pct }) => ({ kind, name, share: pct }));
  const sources = [
    ...of('agent', span.agents),
    ...of('skill', span.skills),
    ...of('plugin', span.plugins),
    ...of('mcp', span.mcp_servers),
  ];
  return {
    requests: span.request_count,
    chats: span.session_count,
    behaviours: span.behaviors
      .map(({ key, pct, count }) => ({ key, share: pct, requests: count }))
      .sort((a, b) => b.share - a.share),
    advice: (span.recommendations ?? []).map(({ key, pct, title, detail }) => ({
      key,
      share: pct,
      title,
      ...(detail ? { detail } : {}),
    })),
    sources: sources.sort((a, b) => b.share - a.share),
  };
}

/** Claude Code's plan, as /usage shows it, read from a process that never gets a message. */
export const claudeUsage: UsageSource = {
  plan: () =>
    probe(async (claude) => {
      // Experimental in the SDK: its name and answer may change in any release.
      const [usage, account] = await Promise.all([
        claude.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
        // Whose limits they are, so each account's history is kept apart.
        claude.accountInfo().catch(() => undefined),
      ]);
      const plan = toPlanUsage(usage, Date.now());
      return account?.email ? { ...plan, account: account.email } : plan;
    }),
  breakdown: () =>
    probe(async (claude) => {
      // Experimental in the SDK: its name and answer may change in any release.
      const usage = await claude.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
        skipBehaviors: false,
      });
      return toUsageBreakdown(usage, Date.now());
    }),
};
