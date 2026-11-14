/** The slider's step between its stops, in tokens. */
export const STEP = 10_000;

/** The round sizes the slider snaps to. */
const ROUND = [200_000, 400_000, 600_000, 800_000, 1_000_000];

/** How near a stop, as a share of the slider's span, a dragged size snaps to it. */
const PULL = 0.025;

/** The stops the slider snaps to: its ends, and the round sizes between them. */
export function stops(min: number, max: number): number[] {
  return [min, ...ROUND.filter((size) => size > min && size < max), max];
}

/** Where a dragged size lands: on a stop near it, else on its step, within the ends. */
export function snap(size: number, min: number, max: number): number {
  const near = stops(min, max).find((stop) => Math.abs(stop - size) <= (max - min) * PULL);
  if (near !== undefined) return near;
  return Math.min(max, Math.max(min, Math.round(size / STEP) * STEP));
}

/** How far along the slider a size is, in percent. */
export function along(size: number, min: number, max: number): number {
  return max > min ? Math.min(100, Math.max(0, ((size - min) / (max - min)) * 100)) : 0;
}
