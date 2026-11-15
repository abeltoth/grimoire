import { SCALES } from '@grimoire/contract';
import { percentOf, stepScale } from './scale';

describe('stepScale', () => {
  it('takes whole steps without drifting', () => {
    expect(stepScale(1, 1)).toBe(1.1);
    expect(stepScale(1.1, 1)).toBe(1.2);
    expect(stepScale(1.2, -2)).toBe(1);
  });

  it('stays within the range', () => {
    expect(stepScale(SCALES.max, 1)).toBe(SCALES.max);
    expect(stepScale(SCALES.min, -1)).toBe(SCALES.min);
  });
});

describe('percentOf', () => {
  it('writes a scale as a whole percentage', () => {
    expect(percentOf(1)).toBe('100%');
    expect(percentOf(1.15)).toBe('115%');
  });
});
