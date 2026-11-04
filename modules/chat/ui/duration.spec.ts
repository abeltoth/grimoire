import { duration } from './duration';

describe('duration', () => {
  it('reads seconds, then minutes, then hours', () => {
    expect(duration(0)).toBe('0s');
    expect(duration(8_900)).toBe('8s');
    expect(duration(134_000)).toBe('2m 14s');
    expect(duration(61_000)).toBe('1m 01s');
    expect(duration(3_900_000)).toBe('1h 05m');
    expect(duration(-5)).toBe('0s');
  });
});
