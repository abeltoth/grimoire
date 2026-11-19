import { Component, computed, input, output, signal } from '@angular/core';
import { tokenCount } from '@ui/app/core/tokens';

/** A part of a pie: what it is, how much, and a key to pick it by, if it can be opened. */
export interface Slice {
  name: string;
  value: number;
  key?: string;
  /** Always counted into "Other", such as what a capped list left out. */
  rest?: true;
  /** How many things it stands for, such as the chats a capped list left out; one by default. */
  count?: number;
  /** The tokens it stands for, read out with its value. */
  tokens?: number;
  /** A word more, read out under its tokens, such as how often a skill ran. */
  note?: string;
}

/** A slice as drawn: its colour and its share of the whole, 0-100. */
export interface DrawnSlice extends Slice {
  color: string;
  share: number;
}

/** The slices' inks, in order; past them, the rest are one faint slice. */
const COLOURS = Array.from({ length: 10 }, (_, i) => `var(--gr-chart-${i + 1})`);
const REST = 'var(--gr-ink-faint)';

/** The drawing's size and the ring's radii, in the SVG's own units. */
const SIZE = 120;
const R = 58;
const HOLE = 36;
const C = SIZE / 2;

/**
 * The largest slices, a colour each, and the rest together as "Other",
 * named with how many it holds when there's a word for them; every share
 * of the sum. In order of size, or as given, such as days in time order.
 */
export function slicesOf(slices: readonly Slice[], unit = '', asGiven = false): DrawnSlice[] {
  const sum = slices.reduce((all, slice) => all + Math.max(slice.value, 0), 0);
  if (!(sum > 0)) return [];
  const own = slices.filter((slice) => !slice.rest && slice.value > 0);
  const largest = [...own].sort((a, b) => b.value - a.value);
  const kept = new Set(largest.slice(0, COLOURS.length));
  const shown = asGiven ? own.filter((slice) => kept.has(slice)) : [...kept];
  const left = [...largest.slice(COLOURS.length), ...slices.filter((slice) => slice.rest)];
  const rest = sum - shown.reduce((all, slice) => all + slice.value, 0);
  const drawn: DrawnSlice[] = shown.map((slice, i) => ({
    ...slice,
    color: COLOURS[i]!,
    share: (slice.value / sum) * 100,
  }));
  // A sliver left by rounding isn't worth a slice.
  if (rest > sum * 0.001) {
    const count = left.reduce((all, slice) => all + (slice.count ?? 1), 0);
    const name = unit && count ? `Other · ${count.toLocaleString()} ${unit}` : 'Other';
    const tokens = left.reduce((all, slice) => all + (slice.tokens ?? 0), 0);
    drawn.push({ name, value: rest, tokens, color: REST, share: (rest / sum) * 100 });
  }
  return drawn;
}

/** A share as a whole percent, with "<1%" for a sliver. */
export function shareText(share: number): string {
  return share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`;
}

/** The point on a circle at a turn from twelve o'clock, clockwise. */
function at(turn: number, radius: number): string {
  const angle = turn * 2 * Math.PI - Math.PI / 2;
  return `${C + radius * Math.cos(angle)},${C + radius * Math.sin(angle)}`;
}

/** A part of the ring from one turn to the next; the whole ring when it's all of it. */
function arc(from: number, to: number): string {
  if (to - from >= 0.9999) {
    const circle = (r: number) =>
      `M${C},${C - r}A${r},${r} 0 1 1 ${C},${C + r}A${r},${r} 0 1 1 ${C},${C - r}Z`;
    return circle(R) + circle(HOLE);
  }
  const large = to - from > 0.5 ? 1 : 0;
  return (
    `M${at(from, R)}A${R},${R} 0 ${large} 1 ${at(to, R)}` +
    `L${at(to, HOLE)}A${HOLE},${HOLE} 0 ${large} 0 ${at(from, HOLE)}Z`
  );
}

/**
 * A ring of shares, such as the cost by model: the ten largest slices and
 * the rest as "Other", a legend with each name and share, and the value and
 * tokens of the slice under the pointer or focus in the middle, the whole's
 * when there's none. A slice with a key opens when picked.
 */
@Component({
  selector: 'gr-usage-pie',
  templateUrl: './pie-chart.html',
  styleUrls: ['./charts.css', './pie-chart.css'],
})
export class UsagePie {
  /** What the ring shows, for screen readers. */
  readonly label = input.required<string>();
  readonly slices = input.required<readonly Slice[]>();
  readonly format = input<(n: number) => string>((n) => n.toLocaleString());
  /** What "Other" holds, such as "chats", to say how many. */
  readonly unit = input('');
  /** Kept in the order given, such as days in time order, rather than largest first. */
  readonly asGiven = input(false);
  /** A slice with a key was picked. */
  readonly picked = output<string>();

  protected readonly size = SIZE;
  protected readonly hovered = signal<number | null>(null);
  protected readonly share = shareText;

  protected readonly layout = computed(() => {
    let turn = 0;
    return slicesOf(this.slices(), this.unit(), this.asGiven()).map((slice, i) => {
      const from = turn;
      turn += slice.share / 100;
      return { slice, i, d: arc(from, turn) };
    });
  });

  protected readonly sum = computed(() =>
    this.layout().reduce((all, each) => all + each.slice.value, 0),
  );
  protected readonly tokensSum = computed(() =>
    this.layout().reduce((all, each) => all + (each.slice.tokens ?? 0), 0),
  );
  protected readonly tokenCount = tokenCount;

  protected show(i: number | null): void {
    this.hovered.set(i);
  }

  protected pick(slice: DrawnSlice): void {
    if (slice.key) this.picked.emit(slice.key);
  }

  /** What a slice holds, for its accessible name. */
  protected spoken(slice: DrawnSlice): string {
    const note = slice.note ? `, ${slice.note}` : '';
    return `${slice.name}: ${this.format()(slice.value)}, ${shareText(slice.share)}${note}`;
  }
}
