import { along, snap, stops } from './compaction-scale';

describe('compaction scale', () => {
  it('stops at its ends and the round sizes between them', () => {
    expect(stops(100_000, 1_000_000)).toEqual([
      100_000, 200_000, 400_000, 600_000, 800_000, 1_000_000,
    ]);
    expect(stops(100_000, 200_000)).toEqual([100_000, 200_000]);
  });

  it('snaps a size near a stop onto it, and any other onto its step', () => {
    expect(snap(392_000, 100_000, 1_000_000)).toBe(400_000);
    expect(snap(431_000, 100_000, 1_000_000)).toBe(430_000);
    expect(snap(1_004_000, 100_000, 1_000_000)).toBe(1_000_000);
    expect(snap(140_000, 100_000, 200_000)).toBe(140_000);
  });

  it('gives how far along a size is, within the ends', () => {
    expect(along(550_000, 100_000, 1_000_000)).toBe(50);
    expect(along(1_200_000, 100_000, 1_000_000)).toBe(100);
    expect(along(200_000, 200_000, 200_000)).toBe(0);
  });
});
