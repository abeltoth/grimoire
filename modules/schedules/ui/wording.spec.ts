import { cadence, clock, upcoming } from './wording';

describe('cadence', () => {
  it('names the days in words, then the time', () => {
    const at = clock('08:00');
    expect(cadence([1, 2, 3, 4, 5], '08:00')).toBe(`Weekdays at ${at}`);
    expect(cadence([0, 1, 2, 3, 4, 5, 6], '08:00')).toBe(`Every day at ${at}`);
    expect(cadence([0, 6], '08:00')).toBe(`Weekends at ${at}`);
    expect(cadence([1], '08:00')).toBe(`Mondays at ${at}`);
    expect(cadence([4, 1, 0], '08:00')).toBe(`Mondays, Thursdays and Sundays at ${at}`);
    expect(cadence([], '08:00')).toBe('On no days');
  });
});

describe('upcoming', () => {
  // A Wednesday.
  const now = new Date(2026, 10, 4, 7, 0).getTime();
  const at = (day: number) => new Date(2026, 10, day, 8, 0).getTime();
  const time = clock('08:00');

  it('says today or tomorrow, then the weekday, then the date', () => {
    expect(upcoming(at(4), now)).toBe(`today at ${time}`);
    expect(upcoming(at(5), now)).toBe(`tomorrow at ${time}`);
    expect(upcoming(at(9), now)).toBe(
      `on ${new Date(at(9)).toLocaleDateString([], { weekday: 'long' })} at ${time}`,
    );
    expect(upcoming(at(12), now)).toBe(
      `on ${new Date(at(12)).toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`,
    );
  });
});
