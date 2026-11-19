import { type Tile, squarify } from './treemap-layout';

const area = (tile: Tile) => tile.w * tile.h;

describe('squarify', () => {
  it('fills the map with blocks in proportion to the values', () => {
    const values = [60, 25, 10, 5];
    const tiles = squarify(values, 250, 100);
    expect(tiles).toHaveLength(4);
    tiles.forEach((tile, i) => expect(area(tile)).toBeCloseTo((values[i]! / 100) * 25_000));
    for (const tile of tiles) {
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.x + tile.w).toBeLessThanOrEqual(250 + 1e-9);
      expect(tile.y + tile.h).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it('keeps blocks near square rather than in thin strips', () => {
    const tiles = squarify([6, 6, 4, 3, 2, 2, 1], 6, 4);
    const ratios = tiles.map((tile) => Math.max(tile.w / tile.h, tile.h / tile.w));
    expect(Math.max(...ratios)).toBeLessThan(3);
  });

  it('gives one value the whole map, and nothing to nothing', () => {
    expect(squarify([7], 250, 100)).toEqual([{ x: 0, y: 0, w: 250, h: 100 }]);
    expect(squarify([], 250, 100)).toEqual([]);
    expect(squarify([0], 250, 100)).toEqual([]);
  });
});
