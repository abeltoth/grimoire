import { Component, computed, input, signal } from '@angular/core';

/** A series drawn in a chart: its name, and the colour its marks wear. */
export interface ChartSeries {
  name: string;
  /** A CSS colour, such as `var(--gr-chart-1)`. */
  color: string;
}

/** One column of a stacked column chart: a part for each series, bottom first. */
export interface Column {
  /** Under the column on the axis; empty for none. */
  label: string;
  /** In full, for the tooltip and the table. */
  name: string;
  parts: readonly number[];
}

/** A point of a line: a reading, and what it belongs with, such as its week; a line breaks between two. */
export interface LinePoint {
  at: number;
  value: number;
  run?: number;
}

/** A series of a line chart: its points, oldest first. */
export interface LineSeries extends ChartSeries {
  points: readonly LinePoint[];
}

/** What a chart shows as a table in place of each of its numbers: a row a line, named. */
export interface ChartTable {
  head: readonly string[];
  rows: readonly { name: string; cells: readonly string[] }[];
}

/** A moment marked on a line chart's time axis. */
export interface ChartTick {
  at: number;
  label: string;
}

/** The drawing's size, in the SVG's own units; it's drawn at the Usage page's width. */
const W = 520;
const H = 190;
const TOP = 12;
const BOTTOM = 24;
const LEFT = 44;
const PLOT_H = H - TOP - BOTTOM;
const BASE = TOP + PLOT_H;
/** The widest a column is drawn, and the gap between the parts of a stack. */
const BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** Clean ticks from 0 up past the largest value: a step of 1, 2, 2.5 or 5 times a power of ten. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((n) => n * power).find((n) => n >= rough)!;
  const ticks = [];
  for (let at = 0; at < max + step / 2 && ticks.length <= count + 1; at += step) ticks.push(at);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** A bar's outline, its top corners rounded and its foot square on the baseline. */
function bar(x: number, top: number, width: number, height: number, rounded: boolean): string {
  const r = rounded ? Math.min(RADIUS, height, width / 2) : 0;
  const foot = top + height;
  return (
    `M${x},${foot}V${top + r}` +
    (r ? `Q${x},${top} ${x + r},${top}` : '') +
    `H${x + width - r}` +
    (r ? `Q${x + width},${top} ${x + width},${top + r}` : '') +
    `V${foot}Z`
  );
}

/**
 * A stacked column chart: a column for each day or hour, each series a
 * part of it, with a legend, a tooltip on hover and focus, and the same
 * numbers as a table.
 */
@Component({
  selector: 'gr-usage-columns',
  templateUrl: './columns-chart.html',
  styleUrl: './charts.css',
})
export class UsageColumns {
  readonly caption = input.required<string>();
  readonly series = input.required<readonly ChartSeries[]>();
  readonly columns = input.required<readonly Column[]>();
  readonly format = input<(n: number) => string>((n) => n.toLocaleString());
  /** A fixed top for the scale, such as 100 for percent; by default, past the tallest column. */
  readonly max = input<number | null>(null);
  /** Off where another chart's table already has the numbers. */
  readonly tabled = input(true);

  protected readonly width = W;
  protected readonly height = H;
  protected readonly left = LEFT;
  protected readonly base = BASE;
  protected readonly hovered = signal<number | null>(null);

  protected readonly layout = computed(() => {
    const columns = this.columns();
    const totals = columns.map((column) => column.parts.reduce((sum, part) => sum + part, 0));
    const max = this.max();
    const ticks = max
      ? [0, 1, 2, 3, 4].map((n) => (n * max) / 4)
      : niceTicks(Math.max(0, ...totals));
    const top = ticks[ticks.length - 1]!;
    const y = (value: number) => BASE - (value / top) * PLOT_H;
    const band = (W - LEFT) / Math.max(columns.length, 1);
    const width = Math.min(BAR, band * 0.6);
    return {
      ticks: ticks.map((value) => ({ value, y: y(value) })),
      columns: columns.map((column, i) => {
        const center = LEFT + band * (i + 0.5);
        const x = center - width / 2;
        const shown = column.parts.map((part, s) => ({ part, s })).filter(({ part }) => part > 0);
        let below = 0;
        const parts = shown.map(({ part, s }, k) => {
          const foot = y(below);
          below += part;
          const head = y(below);
          // A gap of the page's colour keeps each part from the one on it.
          const gap = k < shown.length - 1 ? Math.min(GAP, (foot - head) / 2) : 0;
          return {
            d: bar(x, head + gap, width, Math.max(foot - head - gap, 0), k === shown.length - 1),
            color: this.series()[s]!.color,
          };
        });
        return { column, i, center, total: totals[i]!, parts, band, hit: LEFT + band * i };
      }),
    };
  });

  protected show(i: number | null): void {
    this.hovered.set(i);
  }

  /** What a column holds, for its accessible name. */
  protected spoken(column: Column, total: number): string {
    const parts = column.parts
      .map((part, s) => `${this.series()[s]!.name} ${this.format()(part)}`)
      .join(', ');
    return `${column.name}: ${this.format()(total)}; ${parts}`;
  }

  /** Where the tooltip sits, in percent of the chart's width; it opens away from the nearer edge. */
  protected tipAt(center: number): { left: number; flip: boolean } {
    return { left: (center / W) * 100, flip: center > W / 2 };
  }
}

/**
 * A line chart over time with a fixed scale, by default 0-100%: a line for
 * each series, broken where nothing was read for a while, with a legend,
 * a crosshair and tooltip that snap to the nearest reading, and the same
 * numbers as a table.
 */
@Component({
  selector: 'gr-usage-lines',
  templateUrl: './lines-chart.html',
  styleUrl: './charts.css',
})
export class UsageLines {
  readonly caption = input.required<string>();
  readonly series = input.required<readonly LineSeries[]>();
  readonly from = input.required<number>();
  readonly to = input.required<number>();
  /** The moments labelled under the axis. */
  readonly ticks = input<readonly ChartTick[]>([]);
  /** The moments drawn as a line across the chart, such as when a limit started afresh. */
  readonly marks = input<readonly ChartTick[]>([]);
  /** How far apart two readings may be and still be joined by a line, in ms. */
  readonly breakAfter = input.required<number>();
  /** Each reading holds until the next, as a limit's share does, rather than sloping to it. */
  readonly step = input(false);
  /** A table in place of every reading's numbers. */
  readonly table = input<ChartTable | null>(null);
  readonly max = input(100);
  readonly format = input<(n: number) => string>((n) => `${Math.round(n)}%`);
  /** A reading's moment, for the tooltip and the table. */
  readonly when = input.required<(at: number) => string>();

  protected readonly width = W;
  protected readonly height = H;
  protected readonly left = LEFT;
  protected readonly right = W - 40;
  protected readonly topEdge = TOP;
  protected readonly base = BASE;
  /** The moment the crosshair is on; null when it's off. */
  protected readonly hovered = signal<number | null>(null);

  private readonly x = computed(() => {
    const from = this.from();
    const span = Math.max(this.to() - from, 1);
    return (at: number) => LEFT + ((at - from) / span) * (this.right - LEFT);
  });
  private readonly y = computed(() => {
    const max = this.max();
    return (value: number) => BASE - (Math.min(Math.max(value, 0), max) / max) * PLOT_H;
  });

  /** Every moment anything was read, oldest first. */
  protected readonly moments = computed(() =>
    [...new Set(this.series().flatMap((series) => series.points.map((point) => point.at)))].sort(
      (a, b) => a - b,
    ),
  );

  protected readonly layout = computed(() => {
    const x = this.x();
    const y = this.y();
    const max = this.max();
    const gap = this.breakAfter();
    const lines = this.series().map((series) => {
      const runs: LinePoint[][] = [];
      for (const point of series.points) {
        const run = runs[runs.length - 1];
        const last = run?.[run.length - 1];
        if (run && last && point.at - last.at <= gap && point.run === last.run) run.push(point);
        else runs.push([point]);
      }
      const step = this.step();
      const path = (run: readonly LinePoint[]) =>
        run
          .map((p, i) => {
            const px = x(p.at).toFixed(1);
            const py = y(p.value).toFixed(1);
            return i === 0 ? `M${px},${py}` : step ? `H${px}V${py}` : `L${px},${py}`;
          })
          .join('');
      const end = series.points[series.points.length - 1];
      return {
        series,
        lines: runs.filter((run) => run.length > 1).map(path),
        // A reading with none beside it would draw no line: it gets a dot.
        dots: runs
          .filter((run) => run.length === 1)
          .map(([p]) => ({ x: x(p!.at), y: y(p!.value) })),
        end: end ? { x: x(end.at), y: y(end.value), value: end.value } : null,
      };
    });
    // The latest value of each series beside its end, unless it would crowd another.
    const labelled: number[] = [];
    const labels = lines
      .flatMap((line) => (line.end ? [{ ...line.end }] : []))
      .sort((a, b) => a.y - b.y)
      .filter((end) => {
        if (labelled.some((y) => Math.abs(y - end.y) < 13)) return false;
        labelled.push(end.y);
        return true;
      });
    const step = max / 4;
    return {
      ticks: [0, 1, 2, 3, 4].map((n) => ({ value: n * step, y: y(n * step) })),
      lines,
      labels,
      xTicks: this.ticks().map((tick) => ({ ...tick, x: x(tick.at) })),
      marks: this.marks().map((mark) => ({ ...mark, x: x(mark.at) })),
    };
  });

  /** At the crosshair: its place, and each series' reading there. */
  protected readonly readout = computed(() => {
    const at = this.hovered();
    if (at === null) return null;
    const gap = this.breakAfter();
    return {
      at,
      x: this.x()(at),
      rows: this.series().map((series) => {
        const point =
          series.points.find((p) => p.at === at) ??
          (this.step() ? latestBy(series.points, at, gap) : nearest(series.points, at, gap));
        return { series, point, y: point ? this.y()(point.value) : 0 };
      }),
    };
  });

  /** The crosshair snaps to the reading nearest the pointer. */
  protected point(event: PointerEvent): void {
    const svg =
      (event.currentTarget as SVGElement).ownerSVGElement ?? (event.currentTarget as SVGSVGElement);
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const vx = ((event.clientX - box.left) / box.width) * W;
    const x = this.x();
    let best: number | null = null;
    for (const at of this.moments()) {
      if (best === null || Math.abs(x(at) - vx) < Math.abs(x(best) - vx)) best = at;
    }
    this.hovered.set(best);
  }

  /** The arrow keys step the crosshair from reading to reading; it starts on the latest. */
  protected key(event: KeyboardEvent): void {
    const moments = this.moments();
    if (!moments.length) return;
    const now = this.hovered();
    const i = now === null ? moments.length - 1 : moments.indexOf(now);
    const to =
      event.key === 'ArrowLeft'
        ? Math.max(i - 1, 0)
        : event.key === 'ArrowRight'
          ? Math.min(i + 1, moments.length - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? moments.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    this.hovered.set(moments[to]!);
  }

  protected focus(): void {
    const moments = this.moments();
    if (this.hovered() === null && moments.length) this.hovered.set(moments[moments.length - 1]!);
  }

  protected leave(): void {
    this.hovered.set(null);
  }

  /** What the reading at the crosshair says, for screen readers. */
  protected spoken(readout: NonNullable<ReturnType<UsageLines['readout']>>): string {
    const values = readout.rows
      .map((row) => `${row.series.name} ${row.point ? this.format()(row.point.value) : 'not read'}`)
      .join(', ');
    return `${this.when()(readout.at)}: ${values}`;
  }

  /** A series' reading at a moment, for the table. */
  protected valueAt(series: LineSeries, at: number): string {
    const point = series.points.find((p) => p.at === at);
    return point ? this.format()(point.value) : '–';
  }

  protected tipAt(x: number): { left: number; flip: boolean } {
    return { left: (x / W) * 100, flip: x > W / 2 };
  }
}

/** The latest point at or before a moment, within a span of it: what held then. */
function latestBy<T extends { at: number }>(
  points: readonly T[],
  at: number,
  within: number,
): T | undefined {
  let best: T | undefined;
  for (const point of points) if (point.at <= at && at - point.at <= within) best = point;
  return best;
}

/** The point nearest a moment, within a span of it; none when there's none so near. */
function nearest<T extends { at: number }>(
  points: readonly T[],
  at: number,
  within: number,
): T | undefined {
  let best: T | undefined;
  for (const point of points) {
    const off = Math.abs(point.at - at);
    if (off <= within && (!best || off < Math.abs(best.at - at))) best = point;
  }
  return best;
}
