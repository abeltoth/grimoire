import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { toPlanUsage, toUsageBreakdown } from './claude';

const response = (rateLimits: SDKControlGetUsageResponse['rate_limits']) =>
  ({
    session: {},
    subscription_type: rateLimits ? 'max' : null,
    rate_limits_available: rateLimits !== null,
    rate_limits: rateLimits,
    behaviors: null,
  }) as unknown as SDKControlGetUsageResponse;

// Read on 3 November 2026, local time; the month starts afresh on 1 December.
const at = new Date(2026, 10, 3, 21, 0).getTime();
const firstOfDecember = new Date(2026, 11, 1).getTime();

describe('toPlanUsage', () => {
  it('reads the session, the week and the weeks kept for one model', () => {
    const usage = toPlanUsage(
      response({
        five_hour: { utilization: 37, resets_at: '2026-11-03T01:20:00+00:00' },
        seven_day: { utilization: 70, resets_at: '2026-11-05T14:00:00+00:00' },
        seven_day_opus: { utilization: 12, resets_at: null },
        seven_day_sonnet: null,
        model_scoped: [
          { display_name: 'Opus', utilization: 12, resets_at: null },
          { display_name: 'Fable', utilization: 5, resets_at: null },
        ],
        extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 600, utilization: 12 },
      }),
      at,
    );
    expect(usage).toEqual({
      plan: 'max',
      windows: [
        { span: 'session', used: 37, resetsAt: Date.parse('2026-11-03T01:20:00Z') },
        { span: 'week', used: 70, resetsAt: Date.parse('2026-11-05T14:00:00Z') },
        { span: 'week', model: 'Opus', used: 12, resetsAt: null },
        { span: 'week', model: 'Fable', used: 5, resetsAt: null },
      ],
      credits: { spent: 600, limit: 5000, currency: 'USD', used: 12, resetsAt: firstOfDecember },
      at,
    });
  });

  it('has no windows when the plan has no limits, as with an API key', () => {
    expect(toPlanUsage(response(null), 1000)).toEqual({ plan: null, windows: [], at: 1000 });
  });

  it("reads an organization's monthly allowance, with no session or week limits", () => {
    const usage = toPlanUsage(
      {
        ...response({
          five_hour: null,
          seven_day: null,
          extra_usage: {
            is_enabled: true,
            monthly_limit: 60000,
            used_credits: 12345,
            utilization: null,
            currency: 'usd',
          },
        }),
        subscription_type: 'enterprise',
      },
      at,
    );
    expect(usage).toEqual({
      plan: 'enterprise',
      windows: [],
      credits: {
        spent: 12345,
        limit: 60000,
        currency: 'USD',
        used: 20.575,
        resetsAt: firstOfDecember,
      },
      at,
    });
  });

  it('has no share of an unlimited allowance, and leaves out credits that are turned off', () => {
    const unlimited = {
      is_enabled: true,
      monthly_limit: null,
      used_credits: 900,
      utilization: null,
    };
    expect(toPlanUsage(response({ extra_usage: unlimited }), at).credits).toEqual({
      spent: 900,
      limit: null,
      currency: 'USD',
      used: null,
      resetsAt: firstOfDecember,
    });
    const off = { is_enabled: false, monthly_limit: 5000, used_credits: 0, utilization: 0 };
    expect(toPlanUsage(response({ extra_usage: off }), at).credits).toBeUndefined();
  });
});

describe('toUsageBreakdown', () => {
  const span = (requests: number) => ({
    request_count: requests,
    session_count: 3,
    behaviors: [
      { key: 'long_context', pct: 80, count: 40 },
      { key: 'cron', pct: 82, count: 30 },
    ],
    recommendations: [
      { key: 'cron', pct: 82, title: 'Stop sessions you no longer need' },
      {
        key: 'long_context',
        pct: 80,
        title: 'Start fresh when you switch tasks',
        detail: 'Run /clear.',
      },
    ],
    fix: { keys: ['cron'], messages: ['/effort low'] },
    agents: [{ name: 'Explore', pct: 5 }],
    skills: [],
    plugins: [],
    mcp_servers: [{ name: 'docs', pct: 9 }],
  });

  it('reads what Claude Code says took the usage, the largest share first', () => {
    const usage = { ...response(null), behaviors: { day: span(10), week: span(70) } };
    const breakdown = toUsageBreakdown(usage as unknown as SDKControlGetUsageResponse, at);
    expect(breakdown?.at).toBe(at);
    expect(breakdown?.week.requests).toBe(70);
    expect(breakdown?.day).toEqual({
      requests: 10,
      chats: 3,
      behaviours: [
        { key: 'cron', share: 82, requests: 30 },
        { key: 'long_context', share: 80, requests: 40 },
      ],
      advice: [
        { key: 'cron', share: 82, title: 'Stop sessions you no longer need' },
        {
          key: 'long_context',
          share: 80,
          title: 'Start fresh when you switch tasks',
          detail: 'Run /clear.',
        },
      ],
      sources: [
        { kind: 'mcp', name: 'docs', share: 9 },
        { kind: 'agent', name: 'Explore', share: 5 },
      ],
    });
  });

  it('has none when the scan has none', () => {
    expect(toUsageBreakdown(response(null), at)).toBeNull();
  });
});
