import { type GraphCommit, LANE_COLOURS, layOut } from './graph-layout';

const c = (sha: string, ...parents: string[]): GraphCommit => ({ sha, parents });
/** Each row as its dot's lane. */
const lanesOf = (commits: GraphCommit[]) => layOut(commits).rows.map((row) => row.lane);

describe('layOut', () => {
  it('keeps a straight history in one lane', () => {
    const { rows, state } = layOut([c('c', 'b'), c('b', 'a'), c('a')]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows[0]).toMatchObject({ top: [], bottom: [{ from: 0, to: 0 }], width: 1 });
    expect(rows[1]).toMatchObject({ top: [{ from: 0, to: 0 }], bottom: [{ from: 0, to: 0 }] });
    expect(rows[2]).toMatchObject({ top: [{ from: 0, to: 0 }], bottom: [] });
    expect(state.lanes).toEqual([]);
  });

  it('branches a merge off into a lane of its own and joins it back where it began', () => {
    // m merges f2 into main at b; f1 grew from a.
    const { rows } = layOut([c('m', 'b', 'f2'), c('f2', 'f1'), c('b', 'a'), c('f1', 'a'), c('a')]);
    expect(rows.map((row) => row.lane)).toEqual([0, 1, 0, 1, 0]);
    expect(rows[0]!.bottom).toEqual(
      expect.arrayContaining([
        { from: 0, to: 0, colour: rows[0]!.colour },
        { from: 0, to: 1, colour: rows[1]!.colour },
      ]),
    );
    expect(rows[0]!.colour).not.toBe(rows[1]!.colour);
    // At a, the branch's lane comes back into the main one.
    expect(rows[4]!.top).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 0, to: 0 }),
        expect.objectContaining({ from: 1, to: 0 }),
      ]),
    );
    expect(rows.map((row) => row.width)).toEqual([2, 2, 2, 2, 2]);
  });

  it('gives each parent of an octopus merge a lane', () => {
    const { rows } = layOut([c('m', 'a', 'b', 'd'), c('d', 'a'), c('b', 'a'), c('a')]);
    expect(rows[0]!.bottom.filter((line) => line.from !== line.to).map((l) => l.to)).toEqual([
      1, 2,
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 2, 1, 0]);
    expect(rows[0]!.width).toBe(3);
  });

  it('starts a tip in the first free lane, and reuses a lane once its branch ends', () => {
    // Two tips, x and y; x's branch ends at its root, z then starts in its lane, and y's joins it at q.
    expect(lanesOf([c('x', 'r'), c('y', 'q'), c('r'), c('z', 'q'), c('q')])).toEqual([
      0, 1, 0, 0, 0,
    ]);
  });

  it('carries on from where an earlier page left off', () => {
    const commits = [
      c('m', 'b', 'f2'),
      c('f2', 'f1'),
      c('b', 'a'),
      c('f1', 'a'),
      c('a', 'root'),
      c('root'),
    ];
    const whole = layOut(commits);
    const first = layOut(commits.slice(0, 3));
    const second = layOut(commits.slice(3), first.state);
    expect([...first.rows, ...second.rows]).toEqual(whole.rows);
    expect(second.state).toEqual(whole.state);
  });

  it('cycles the colours', () => {
    const tips = Array.from({ length: LANE_COLOURS + 1 }, (_, i) => c(`t${i}`));
    const colours = layOut(tips).rows.map((row) => row.colour);
    expect(colours[0]).toBe(colours[LANE_COLOURS]);
    expect(new Set(colours).size).toBe(LANE_COLOURS);
  });
});
