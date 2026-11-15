/** How many lane colours the theme has; lanes cycle through them. */
export const LANE_COLOURS = 8;

/** A commit as the layout needs it. */
export interface GraphCommit {
  sha: string;
  parents: readonly string[];
}

/** Where the lanes stand after a row: the commit each lane waits for, null when free. */
export interface LaneState {
  readonly lanes: readonly (string | null)[];
  readonly colours: readonly number[];
  readonly nextColour: number;
}

/** A line across half a row, from a lane at one edge to a lane at the other. */
export interface GraphLine {
  from: number;
  to: number;
  colour: number;
}

/** One row of the graph: its commit's dot, and the lines through its top and bottom halves. */
export interface GraphRow {
  lane: number;
  colour: number;
  /** From the row's top edge to its middle. */
  top: GraphLine[];
  /** From the row's middle to its bottom edge. */
  bottom: GraphLine[];
  /** How many lanes the row spans. */
  width: number;
}

export const NO_LANES: LaneState = { lanes: [], colours: [], nextColour: 0 };

/**
 * Lays commits, in graph order, out in lanes: a commit takes the lane
 * waiting for it, its first parent carries on there, and other parents
 * branch off into lanes of their own. It starts where an earlier page
 * left off, so pages laid out one after another join up.
 */
export function layOut(
  commits: readonly GraphCommit[],
  from: LaneState = NO_LANES,
): { rows: GraphRow[]; state: LaneState } {
  const lanes = [...from.lanes];
  const colours = [...from.colours];
  let nextColour = from.nextColour;
  const fresh = () => nextColour++ % LANE_COLOURS;
  const free = (taken: number) => {
    const at = lanes.findIndex((sha, i) => sha === null && i !== taken);
    return at < 0 ? Math.max(lanes.length, taken + 1) : at;
  };

  const rows = commits.map((commit): GraphRow => {
    const before = [...lanes];
    const waiting = before.flatMap((sha, i) => (sha === commit.sha ? [i] : []));
    const lane = waiting[0] ?? free(-1);
    if (!waiting.length) colours[lane] = fresh();
    const colour = colours[lane]!;

    const top: GraphLine[] = [];
    before.forEach((sha, i) => {
      if (sha !== null)
        top.push({ from: i, to: sha === commit.sha ? lane : i, colour: colours[i]! });
    });
    for (const merged of waiting.slice(1)) lanes[merged] = null;

    const [first, ...others] = commit.parents;
    lanes[lane] = first ?? null;
    const bottom: GraphLine[] = [];
    const branched = new Set<number>();
    for (const parent of others) {
      let at = lanes.indexOf(parent);
      if (at < 0) {
        at = free(lane);
        lanes[at] = parent;
        colours[at] = fresh();
        branched.add(at);
      }
      bottom.push({ from: lane, to: at, colour: colours[at]! });
    }
    lanes.forEach((sha, i) => {
      if (sha !== null && !branched.has(i)) bottom.unshift({ from: i, to: i, colour: colours[i]! });
    });

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const width = Math.max(
      before.length,
      lanes.length,
      lane + 1,
      ...[...branched].map((i) => i + 1),
    );
    return { lane, colour, top, bottom, width };
  });

  colours.length = lanes.length;
  return { rows, state: { lanes, colours, nextColour } };
}
