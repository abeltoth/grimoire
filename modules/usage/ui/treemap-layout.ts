/** A block's place in the map, in the units of the map's width and height. */
export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

const sum = (areas: readonly number[]) => areas.reduce((all, area) => all + area, 0);

/** How far from square the worst of a row's blocks is, laid along a side: 1 is square. */
function worst(row: readonly number[], side: number): number {
  const all = sum(row);
  const most = Math.max(...row);
  const least = Math.min(...row);
  return Math.max((side * side * most) / (all * all), (all * all) / (side * side * least));
}

/**
 * Blocks with areas in proportion to the values, filling a width by a
 * height, as near square as they can be: each row along the shorter side
 * takes blocks while that keeps its worst one squarer (Bruls, Huizing and
 * van Wijk's squarified treemap). The values are positive, largest first;
 * the tiles come in their order.
 */
export function squarify(values: readonly number[], width: number, height: number): Tile[] {
  const total = sum(values);
  if (!(total > 0) || !(width > 0) || !(height > 0)) return [];
  const areas = values.map((value) => (value * width * height) / total);
  const tiles: Tile[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    const row = [areas[i]!];
    let next = i + 1;
    while (next < areas.length && worst([...row, areas[next]!], side) <= worst(row, side))
      row.push(areas[next++]!);
    const thickness = sum(row) / side;
    let along = 0;
    for (const area of row) {
      const length = area / thickness;
      tiles.push(
        w >= h
          ? { x, y: y + along, w: thickness, h: length }
          : { x: x + along, y, w: length, h: thickness },
      );
      along += length;
    }
    if (w >= h) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
    i = next;
  }
  return tiles;
}
