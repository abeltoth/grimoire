import { Component, computed, input, signal } from '@angular/core';
import { type AboutRow, UsageAbout } from './about-tip';

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
  /** In full, for the tooltip. */
  name: string;
  parts: readonly number[];
  /** A word more for the tooltip, such as what the column cost. */
  note?: string;
}

/** A moment marked on a line chart's time axis. */
export interface ChartTick {
  at: number;
  label: string;
}

/** The drawing's size, in the SVG's own units; it's drawn at the Usage page's width. */
export const W = 520;
export const H = 190;
export const TOP = 12;
const BOTTOM = 24;
export const LEFT = 44;
export const PLOT_H = H - TOP - BOTTOM;
export const BASE = TOP + PLOT_H;
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
 * part of it, with a legend and a tooltip on hover and focus; whatever is
 * put inside it, such as a choice of what it counts, sits by its caption.
 */
@Component({
  selector: 'gr-usage-columns',
  imports: [UsageAbout],
  templateUrl: './columns-chart.html',
  styleUrl: './charts.css',
})
export class UsageColumns {
  readonly caption = input.required<string>();
  /** What the series mean, behind an icon beside the caption; none by default. */
  readonly about = input<readonly AboutRow[]>([]);
  readonly series = input.required<readonly ChartSeries[]>();
  readonly columns = input.required<readonly Column[]>();
  readonly format = input<(n: number) => string>((n) => n.toLocaleString());
  /** A fixed top for the scale, such as 100 for percent; by default, past the tallest column. */
  readonly max = input<number | null>(null);
  /** A value marked across the chart, dashed and named in the legend, where no column can cover its name. */
  readonly rule = input<{ value: number; label: string } | null>(null);

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
      : niceTicks(Math.max(0, this.rule()?.value ?? 0, ...totals));
    const top = ticks[ticks.length - 1]!;
    const y = (value: number) => BASE - (value / top) * PLOT_H;
    const rule = this.rule();
    const band = (W - LEFT) / Math.max(columns.length, 1);
    const width = Math.min(BAR, band * 0.6);
    return {
      rule: rule ? { y: y(rule.value) } : null,
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
    const note = column.note ? `; ${column.note}` : '';
    return `${column.name}: ${this.format()(total)}; ${parts}${note}`;
  }

  /** Where the tooltip sits, in percent of the chart's width; it opens away from the nearer edge. */
  protected tipAt(center: number): { left: number; flip: boolean } {
    return { left: (center / W) * 100, flip: center > W / 2 };
  }
}
