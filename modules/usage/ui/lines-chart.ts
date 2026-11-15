import { Component, computed, input, signal } from '@angular/core';
import { BASE, type ChartSeries, type ChartTick, H, LEFT, PLOT_H, TOP, W } from './charts';

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

/** A dashed line from one point to another, such as a pace to keep; the crosshair passes it by. */
export interface ChartGuide extends ChartSeries {
  from: LinePoint;
  to: LinePoint;
  /** Written by its end, in place of a legend; none when the line it leads on from says what it is. */
  label?: string;
}

/**
 * A line chart over time with a fixed scale, by default 0-100%: a line for
 * each series, broken where nothing was read for a while, the ground under
 * it shaded if asked, with a legend, a crosshair and tooltip that snap to
 * the nearest reading, any dashed guides, and the same numbers as a table.
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
  /**
   * How a line goes from reading to reading: straight; in a step, each
   * holding until the next; or smooth, a curve that never rises past either.
   */
  readonly curve = input<'straight' | 'step' | 'smooth'>('straight');
  /** Dashed lines drawn under the series, each named by its end. */
  readonly guides = input<readonly ChartGuide[]>([]);
  /** The ground under each line shaded in its colour. */
  readonly area = input(false);
  /** A dot on every reading, for lines of few, such as one a week. */
  readonly dots = input(false);
  /** Off where the page already says what the lines show. */
  readonly tabled = input(true);
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
      const curve = this.curve();
      const path = (run: readonly LinePoint[]) =>
        curve === 'smooth'
          ? smoothPath(run.map((p) => ({ x: x(p.at), y: y(p.value) })))
          : run
              .map((p, i) => {
                const px = x(p.at).toFixed(1);
                const py = y(p.value).toFixed(1);
                return i === 0
                  ? `M${px},${py}`
                  : curve === 'step'
                    ? `H${px}V${py}`
                    : `L${px},${py}`;
              })
              .join('');
      const end = series.points[series.points.length - 1];
      const joined = runs.filter((run) => run.length > 1);
      return {
        series,
        lines: joined.map(path),
        areas: this.area()
          ? joined.map((run) => `${path(run)}V${BASE}H${x(run[0]!.at).toFixed(1)}Z`)
          : [],
        // A reading with none beside it would draw no line: it gets a dot.
        dots: (this.dots()
          ? series.points
          : runs.filter((run) => run.length === 1).map(([p]) => p!)
        ).map((p) => ({ x: x(p.at), y: y(p.value) })),
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
    const guides = this.guides().map((guide) => ({
      guide,
      d: `M${x(guide.from.at).toFixed(1)},${y(guide.from.value).toFixed(1)}L${x(guide.to.at).toFixed(1)},${y(guide.to.value).toFixed(1)}`,
      label: guideLabel(x(guide.to.at), y(guide.to.value), this.right),
    }));
    return {
      guides,
      // Three lines across are enough to read a share by.
      ticks: [0, 1, 2].map((n) => ({ value: (n * max) / 2, y: y((n * max) / 2) })),
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
          (this.curve() === 'step'
            ? latestBy(series.points, at, gap)
            : nearest(series.points, at, gap));
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

/**
 * A curve through points left to right that rises and falls only where
 * they do, never past the points on either side: a monotone cubic
 * (Fritsch and Carlson), so a share that only grows is drawn only growing.
 */
export function smoothPath(points: readonly { x: number; y: number }[]): string {
  const n = points.length;
  if (!n) return '';
  const at = (p: { x: number; y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  if (n < 3) return `M${points.map(at).join('L')}`;
  const slopes = points
    .slice(1)
    .map((p, i) => (p.y - points[i]!.y) / Math.max(p.x - points[i]!.x, 1e-9));
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0]!;
    if (i === n - 1) return slopes[n - 2]!;
    const [a, b] = [slopes[i - 1]!, slopes[i]!];
    // Where the line turns or holds, the curve flattens rather than overshoots.
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  let d = `M${at(points[0]!)}`;
  for (let i = 0; i < n - 1; i++) {
    const [p, q] = [points[i]!, points[i + 1]!];
    const h = (q.x - p.x) / 3;
    d += `C${at({ x: p.x + h, y: p.y + tangents[i]! * h })} ${at({ x: q.x - h, y: q.y - tangents[i + 1]! * h })} ${at(q)}`;
  }
  return d;
}

/** Where a guide's label goes: past its end where there's room, else over it, ending there. */
function guideLabel(x: number, y: number, right: number) {
  return x < right - 60
    ? { x: x + 6, y, dy: '0.32em', anchor: 'start' }
    : { x, y: y - 6, dy: '0', anchor: 'end' };
}
