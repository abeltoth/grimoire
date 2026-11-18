import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CommandRequest, TokenTotals, UsageBreakdown } from '@grimoire/contract';
import { useFakeBridge } from '@ui/testing/app-testing';
import { TokenReadings } from './token-readings';

const zero = { input: 0, cacheWritten: 0, cacheWrittenLong: 0, cacheRead: 0, output: 0 };
const none = { ...zero, cost: zero, dollars: 0 };
const totals = (since: number): TokenTotals => ({
  since,
  total: none,
  unpriced: 0,
  chatCount: 0,
  days: [],
  hours: [],
  models: [],
  folders: [],
  chats: [],
  tools: [],
  skills: [],
});
const span = { requests: 1, chats: 1, behaviours: [], advice: [], sources: [] };

describe('TokenReadings', () => {
  const now = new Date(2026, 10, 9, 15, 30).getTime();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setUp() {
    const fake = useFakeBridge();
    fake.answers['search.tokens'] = ({ since }: CommandRequest<'search.tokens'>) => totals(since);
    fake.answers['usage.breakdown'] = (): UsageBreakdown => ({ day: span, week: span, at: 0 });
    TestBed.configureTestingModule({ providers: [TokenReadings] });
    const stable = () => TestBed.inject(ApplicationRef).whenStable();
    return { ...fake, readings: TestBed.inject(TokenReadings), stable };
  }

  it("reads the week's count and the agents' word once the agents are known", async () => {
    const { readings, stable } = setUp();
    await stable();
    expect(readings.totals()!.since).toBe(now - 7 * 24 * 60 * 60_000);
    expect(readings.breakdowns()!.map((each) => each.agent.id)).toEqual(['claude-code']);
  });

  it('counts again for another span, without asking the agents again', async () => {
    const { readings, calls, stable } = setUp();
    await stable();
    await readings.showSpan('day');
    expect(readings.totals()!.since).toBe(now - 24 * 60 * 60_000);
    expect(calls.filter((c) => c.command === 'search.tokens')).toHaveLength(2);
    expect(calls.filter((c) => c.command === 'usage.breakdown')).toHaveLength(1);
  });

  it('keeps what went wrong', async () => {
    const { readings, answers, stable } = setUp();
    answers['search.tokens'] = () => {
      throw new Error('The search stopped');
    };
    answers['usage.breakdown'] = () => {
      throw new Error('No answer');
    };
    await stable();
    expect(readings.totalsFailed()).toBe('The search stopped');
    expect(readings.breakdownsFailed()).toBe('No answer');
  });
});
