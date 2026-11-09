import { describe, expect, it } from 'vitest';
import { dueTimes, isTime, nextDue } from './times';

// Local times, so the tests read the same in any time zone. 4 November 2026 is a Wednesday.
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
const weekdays = { days: [1, 2, 3, 4, 5], time: '08:00' };
const WEEK = 7 * 24 * 60 * 60_000;

describe('nextDue', () => {
  it('finds the next day and time it runs on', () => {
    expect(nextDue(weekdays, at(4, 7))).toBe(at(4, 8));
    expect(nextDue(weekdays, at(4, 8))).toBe(at(5, 8));
    // Friday after eight: Monday.
    expect(nextDue(weekdays, at(6, 9))).toBe(at(9, 8));
    expect(nextDue({ days: [1], time: '09:30' }, at(9, 9, 30))).toBe(at(16, 9, 30));
  });

  it('has none without days or a time', () => {
    expect(nextDue({ days: [], time: '08:00' }, at(4, 7))).toBeNull();
    expect(nextDue({ days: [3], time: '8am' }, at(4, 7))).toBeNull();
  });
});

describe('dueTimes', () => {
  it('lists the times it was due since, oldest first', () => {
    expect(dueTimes(weekdays, at(6, 9), at(10, 9), WEEK)).toEqual([at(9, 8), at(10, 8)]);
    expect(dueTimes(weekdays, at(4, 8), at(4, 9), WEEK)).toEqual([]);
    expect(dueTimes(weekdays, at(4, 7), at(4, 8), WEEK)).toEqual([at(4, 8)]);
  });

  it('goes back no further than it is told', () => {
    expect(dueTimes(weekdays, 0, at(10, 9), 20 * 60 * 60_000)).toEqual([at(10, 8)]);
  });
});

describe('isTime', () => {
  it('takes 24-hour times with minutes', () => {
    expect(['00:00', '08:00', '23:59'].map(isTime)).toEqual([true, true, true]);
    expect(['24:00', '8:00', '08:60', ''].map(isTime)).toEqual([false, false, false, false]);
  });
});
