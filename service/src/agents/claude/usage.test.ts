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
        extra_usage: { is_enabled: true, monthly_limit: 50, used_credits: 6, utilization: 12 },
      }),
      1000,
    );
    expect(usage).toEqual({
      plan: 'max',
      windows: [
        { span: 'session', used: 37, resetsAt: Date.parse('2026-11-03T01:20:00Z') },
        { span: 'week', used: 70, resetsAt: Date.parse('2026-11-05T14:00:00Z') },
        { span: 'week', model: 'Opus', used: 12, resetsAt: null },
        { span: 'week', model: 'Fable', used: 5, resetsAt: null },
      ],
      extra: 12,
      at: 1000,
    });
  });

  it('has no windows when the plan has no limits, as with an API key', () => {
    expect(toPlanUsage(response(null), 1000)).toEqual({ plan: null, windows: [], at: 1000 });
  });
});
