import { Component, computed, input, signal } from '@angular/core';
import { LEFT, W } from './charts';
import type { LimitSession } from './limits-chart';
import { HOUR, dayTick, hourName, percent, startOf, time, weekday } from './usage-format';

/** A day's row, the gap between rows, and the room above and below them, in the SVG's own units. */
const ROW = 18;
const ROW_GAP = 6;
const TOP = 4;
const BOTTOM = 24;
const RIGHT = W - 40;
/** The hours named under the rows. */
const HOURS = [0, 6, 12, 18, 24];
/** How faint a session that used little of its limit is drawn, so none vanishes. */
const FAINTEST = 0.25;

/**
 * The week's five-hour sessions on a timeline: a row a day, each session
 * drawn where it ran, the fuller the darker, those that ran out marked
 * where they did, with a tooltip on hover and focus.
 */
@Component({
  selector: 'gr-usage-sessions',
  templateUrl: './sessions-chart.html',
  styleUrls: ['./charts.css', './sessions-chart.css'],
})
export class UsageSessions {
  readonly caption = input.required<string>();
  readonly sessions = input.required<readonly LimitSession[]>();
  /** When the week began: its day is the first row. */
  readonly from = input.required<number>();
  /** Its day is the last row. */
  readonly now = input.required<number>();

  protected readonly width = W;
  protected readonly left = LEFT;
  protected readonly right = RIGHT;
  protected readonly rowHeight = ROW;
  protected readonly hovered = signal<number | null>(null);
  protected readonly percent = percent;

  protected readonly layout = computed(() => {
    const days: { start: number; end: number }[] = [];
    const last = startOf(this.now(), 'day').getTime();
    for (const day = startOf(this.from(), 'day'); day.getTime() <= last;) {
      const start = day.getTime();
      day.setDate(day.getDate() + 1);
      days.push({ start, end: day.getTime() });
    }
    const rowY = (i: number) => TOP + i * (ROW + ROW_GAP);
    const x = (day: { start: number; end: number }, at: number) =>
      LEFT + ((at - day.start) / (day.end - day.start)) * (RIGHT - LEFT);
    const base = rowY(days.length) - ROW_GAP;
    const blocks = this.sessions().flatMap((session, s) =>
      days.flatMap((day, i) => {
        const from = Math.max(session.start, day.start);
        const to = Math.min(session.end, day.end);
        if (from >= to) return [];
        const full =
          session.fullAt !== null && session.fullAt >= day.start && session.fullAt < day.end
            ? x(day, session.fullAt)
            : null;
        return [
          {
            s,
            x: x(day, from),
            y: rowY(i),
            width: Math.max(x(day, to) - x(day, from), 1),
            opacity: FAINTEST + (1 - FAINTEST) * (Math.min(session.peak, 100) / 100),
            full,
          },
        ];
      }),
    );
    const first = days[0] ?? { start: this.from(), end: this.from() + 24 * HOUR };
    return {
      height: base + BOTTOM,
      base,
      rows: days.map((day, i) => ({ y: rowY(i), label: dayTick(day.start) })),
      hours: HOURS.map((h) => ({
        x: LEFT + (h / 24) * (RIGHT - LEFT),
        label: h === 24 ? '' : hourName(first.start + h * HOUR),
      })),
      blocks,
    };
  });

  /** A session in words, for its tooltip and its accessible name. */
  protected named(session: LimitSession): string {
    const ran = `${weekday(session.start)} ${time(session.start)} to ${time(session.end)}`;
    const full = session.fullAt === null ? '' : `, ran out at ${time(session.fullAt)}`;
    return `${ran}: peaked at ${percent(session.peak)}${full}`;
  }

  protected show(s: number | null): void {
    this.hovered.set(s);
  }

  /** Where the tooltip sits, in percent of the chart's size; it opens away from the nearer edge. */
  protected tipAt(
    x: number,
    y: number,
    height: number,
  ): { left: number; top: number; flip: boolean } {
    return { left: (x / W) * 100, top: ((y + ROW) / height) * 100, flip: x > W / 2 };
  }
}
