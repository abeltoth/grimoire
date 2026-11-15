import { Component, input } from '@angular/core';
import type { GraphLine, GraphRow } from './graph-layout';

/**
 * One row of the commit graph: the lines through it and its commit's dot,
 * drawn in lane units, a lane 1 wide and a row 2 high.
 */
@Component({
  selector: 'gr-git-lanes',
  templateUrl: './git-lanes.html',
  styleUrl: './git-lanes.css',
  host: { 'aria-hidden': 'true', '[style.--lanes]': 'row().width' },
})
export class GitLanes {
  readonly row = input.required<GraphRow>();
  /** The dot is hollow, for the changes not committed yet. */
  readonly open = input(false);

  /** A line across the top half (`y` 0) or the bottom half (`y` 1), curving where it changes lane. */
  protected path(line: GraphLine, y: number): string {
    const [x1, x2] = [line.from + 0.5, line.to + 0.5];
    if (x1 === x2) return `M ${x1} ${y} V ${y + 1}`;
    return `M ${x1} ${y} C ${x1} ${y + 0.5}, ${x2} ${y + 0.5}, ${x2} ${y + 1}`;
  }
}
