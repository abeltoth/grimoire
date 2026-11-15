import { SCALES } from '@grimoire/contract';

/** The scale a number of steps from this one, kept within the range and rounded to whole percents. */
export function stepScale(scale: number, steps: number): number {
  const next = Math.round((scale + steps * SCALES.step) * 100) / 100;
  return Math.min(SCALES.max, Math.max(SCALES.min, next));
}

/** A scale as a percentage, such as "120%". */
export function percentOf(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
