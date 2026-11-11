import { fromInput, inAnHour, toInput, tomorrowMorning, whenLabel } from './when';

const at = (...parts: number[]) => new Date(...(parts as [number, number])).getTime();
const time = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

describe('when', () => {
  const now = at(2026, 10, 11, 15, 20, 30);

  it('says a reminder’s day as today, tomorrow, or its date, with the year only when it isn’t this one', () => {
    const today = at(2026, 10, 11, 18, 0);
    const tomorrow = at(2026, 10, 12, 9, 0);
    const saturday = at(2026, 10, 14, 9, 0);
    const later = at(2027, 0, 4, 9, 0);
    expect(whenLabel(today, now)).toBe(`today at ${time(today)}`);
    expect(whenLabel(tomorrow, now)).toBe(`tomorrow at ${time(tomorrow)}`);
    expect(whenLabel(saturday, now)).toMatch(/^Sat/);
    expect(whenLabel(saturday, now)).toContain('14');
    expect(whenLabel(saturday, now)).not.toContain('2026');
    expect(whenLabel(later, now)).toContain('2027');
  });

  it('picks an hour from now to the minute, and tomorrow at nine', () => {
    expect(inAnHour(now)).toBe(at(2026, 10, 11, 16, 20));
    expect(tomorrowMorning(now)).toBe(at(2026, 10, 12, 9, 0));
    expect(tomorrowMorning(at(2026, 11, 31, 23, 0))).toBe(at(2027, 0, 1, 9, 0));
  });

  it('turns a moment into a datetime-local field’s value and back, in local time', () => {
    const friday = at(2026, 10, 14, 9, 5);
    expect(toInput(friday)).toBe('2026-11-14T09:05');
    expect(fromInput('2026-11-14T09:05')).toBe(friday);
    expect(fromInput('')).toBeUndefined();
    expect(fromInput('soon')).toBeUndefined();
  });
});
