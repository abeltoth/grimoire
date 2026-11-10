import {
  againstMost,
  behaviourName,
  dayKey,
  dayName,
  filled,
  limitName,
  money,
  planName,
  resets,
  spent,
  startOf,
  time,
  uses,
} from './usage-format';

describe('usage formats', () => {
  const now = new Date(2026, 10, 9, 15, 30).getTime();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names local days and starts them at midnight', () => {
    expect(dayKey(new Date(2026, 0, 3))).toBe('2026-01-03');
    expect(startOf(now, 'day').getTime()).toBe(new Date(2026, 10, 9).getTime());
    expect(startOf(now, 'hour').getTime()).toBe(new Date(2026, 10, 9, 15).getTime());
    expect(dayName('2026-11-05')).toBe(
      new Date(2026, 10, 5).toLocaleDateString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
    );
  });

  it('says when a limit resets: today, tomorrow, or on a weekday', () => {
    const at = (days: number, hours: number) => new Date(2026, 10, 9 + days, hours).getTime();
    expect(resets(at(0, 23))).toBe(`resets at ${time(at(0, 23))}`);
    expect(resets(at(1, 9))).toBe(`resets tomorrow at ${time(at(1, 9))}`);
    const weekday = new Date(at(3, 9)).toLocaleDateString([], { weekday: 'long' });
    expect(resets(at(3, 9))).toBe(`resets ${weekday} at ${time(at(3, 9))}`);
    expect(resets(null)).toBe('');
  });

  it('writes money in the currency, or as cents with a code Intl refuses', () => {
    const dollars = new Intl.NumberFormat([], { style: 'currency', currency: 'USD' });
    expect(money(12345, 'USD')).toBe(dollars.format(123.45));
    expect(money(12345, 'DOLLARS')).toBe('123.45 DOLLARS');
    const credits = { spent: 12345, limit: 60000, currency: 'USD', used: 20, resetsAt: 0 };
    expect(spent(credits)).toBe(`${dollars.format(123.45)} of ${dollars.format(600)}`);
    expect(spent({ ...credits, spent: null, limit: null })).toBe('– spent, no limit');
  });

  it('names plans and limits', () => {
    expect(planName('max')).toBe('Max plan');
    expect(limitName({ span: 'session', used: 1, resetsAt: null })).toBe('Current session');
    expect(limitName({ span: 'week', used: 1, resetsAt: null })).toBe('This week, all models');
    expect(limitName({ span: 'week', model: 'Opus', used: 1, resetsAt: null })).toBe(
      'This week, Opus',
    );
  });

  it('keeps a meter within its bounds, and weighs uses against the most used', () => {
    expect([filled(null), filled(-5), filled(42), filled(140)]).toEqual([0, 0, 42, 100]);
    const tools = [
      { name: 'Read', uses: 40 },
      { name: 'Bash', uses: 10 },
    ];
    expect(againstMost(tools[1]!, tools)).toBe(25);
    expect(againstMost({ name: 'None', uses: 0 }, [])).toBe(0);
    expect([uses(1), uses(12)]).toEqual(['1 use', '12 uses']);
  });

  it("names Claude Code's ways of working, keeping its own name for one it doesn't know", () => {
    expect(behaviourName('long_context')).toBe('Long context');
    expect(behaviourName('brand_new')).toBe('brand new');
  });
});
