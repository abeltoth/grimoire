import type { SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { toPlanUsage } from './usage';

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
          extra_usage: { is_enabled: true, monthly_limit: 60000, used_credits: 12345, utilization: null, currency: 'usd' },
        }),
        subscription_type: 'enterprise',
      },
      at,
    );
    expect(usage).toEqual({
      plan: 'enterprise',
      windows: [],
      credits: { spent: 12345, limit: 60000, currency: 'USD', used: 20.575, resetsAt: firstOfDecember },
      at,
    });
  });

  it('has no share of an unlimited allowance, and leaves out credits that are turned off', () => {
    const unlimited = { is_enabled: true, monthly_limit: null, used_credits: 900, utilization: null };
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
