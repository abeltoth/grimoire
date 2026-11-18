import { Component, computed, input, output, signal } from '@angular/core';

/** A part of a pie: what it is, how much, and a key to pick it by, if it can be opened. */
export interface Slice {
  name: string;
  value: number;
  key?: string;
  /** Always counted into "Other", such as what a capped list left out. */
  rest?: true;
}

/** A slice as drawn: its colour and its share of the whole, 0-100. */
export interface DrawnSlice extends Slice {
  color: string;
  share: number;
}

/** The slices' inks, in order; past them, the rest are one faint slice. */
const COLOURS = [1, 2, 3, 4, 5, 6].map((n) => `var(--gr-chart-${n})`);
const REST = 'var(--gr-ink-faint)';

/** The drawing's size and the pie's radius, in the SVG's own units. */
const SIZE = 120;
const R = 58;
const C = SIZE / 2;

/** The heaviest slices, a colour each, and the rest together as "Other"; every share of the sum. */
export function slicesOf(slices: readonly Slice[]): DrawnSlice[] {
  const sum = slices.reduce((all, slice) => all + Math.max(slice.value, 0), 0);
  if (!(sum > 0)) return [];
  const own = slices.filter((slice) => !slice.rest && slice.value > 0);
  own.sort((a, b) => b.value - a.value);
  const shown = own.length > COLOURS.length ? own.slice(0, COLOURS.length) : own;
  const rest = sum - shown.reduce((all, slice) => all + slice.value, 0);
  const drawn: DrawnSlice[] = shown.map((slice, i) => ({
    ...slice,
    color: COLOURS[i]!,
    share: (slice.value / sum) * 100,
  }));
  // A sliver left by rounding isn't worth a slice.
  if (rest > sum * 0.001)
    drawn.push({ name: 'Other', value: rest, color: REST, share: (rest / sum) * 100 });
  return drawn;
}

/** A share as a whole percent, with "<1%" for a sliver. */
export function shareText(share: number): string {
  return share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`;
}

/** The point on the rim at a turn of the circle from twelve o'clock, clockwise. */
function rim(turn: number, radius = R): [number, number] {
  const angle = turn * 2 * Math.PI - Math.PI / 2;
  return [C + radius * Math.cos(angle), C + radius * Math.sin(angle)];
}

/** A wedge from one turn to the next; the whole disc when it's all of it. */
function wedge(from: number, to: number): string {
  if (to - from >= 0.9999)
    return `M${C},${C - R}A${R},${R} 0 1 1 ${C},${C + R}A${R},${R} 0 1 1 ${C},${C - R}Z`;
  const [x0, y0] = rim(from);
  const [x1, y1] = rim(to);
  return `M${C},${C}L${x0},${y0}A${R},${R} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x1},${y1}Z`;
}

/**
 * A pie of shares, such as the tokens by model: the heaviest six slices
 * and the rest as "Other", a legend with each share, and a tooltip on
 * hover and focus. A slice with a key opens when picked.
 */
@Component({
  selector: 'gr-usage-pie',
  templateUrl: './pie-chart.html',
  styleUrls: ['./charts.css', './pie-chart.css'],
})
export class UsagePie {
  readonly caption = input.required<string>();
  readonly slices = input.required<readonly Slice[]>();
  readonly format = input<(n: number) => string>((n) => n.toLocaleString());
  /** A slice with a key was picked. */
  readonly picked = output<string>();

  protected readonly size = SIZE;
  protected readonly hovered = signal<number | null>(null);
  protected readonly share = shareText;

  protected readonly layout = computed(() => {
    let turn = 0;
    return slicesOf(this.slices()).map((slice, i) => {
      const from = turn;
      turn += slice.share / 100;
      const [x, y] = rim((from + turn) / 2, R * 0.6);
      return {
        slice,
        i,
        d: wedge(from, turn),
        tip: { left: (x / SIZE) * 100, top: (y / SIZE) * 100 },
      };
    });
  });

  protected show(i: number | null): void {
    this.hovered.set(i);
  }

  protected pick(slice: DrawnSlice): void {
    if (slice.key) this.picked.emit(slice.key);
  }

  /** What a slice holds, for its accessible name. */
  protected spoken(slice: DrawnSlice): string {
    return `${slice.name}: ${this.format()(slice.value)}, ${shareText(slice.share)}`;
  }
}
