import type { Used, UsageCredits, UsageSpan, UsageWindow } from '@grimoire/contract';
import { modelLabel } from '@ui/app/core/tokens';

/** An hour and a day in ms, as the Usage page's views and charts count back by them. */
export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;

/** The start of the local day or hour a time falls in. */
export function startOf(at: number, unit: 'day' | 'hour'): Date {
  const date = new Date(at);
  if (unit === 'day') date.setHours(0, 0, 0, 0);
  else date.setMinutes(0, 0, 0);
  return date;
}

/** A local day as YYYY-MM-DD, as the totals name it. */
export function dayKey(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export const weekday = (at: number) => new Date(at).toLocaleDateString([], { weekday: 'short' });
/** A day on a chart's axis, such as "Sat 31": a week back is the same weekday as today. */
export const dayTick = (at: number) => `${weekday(at)} ${new Date(at).getDate()}`;
export const hourName = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric' });
export const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** A day, such as "Thursday, November 5". */
export function dayName(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!).toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** An hour, such as "Thursday, 2 PM to 3 PM". */
export function hourSpan(from: number, to: number): string {
  const day = new Date(from).toLocaleDateString([], { weekday: 'long' });
  return `${day}, ${hourName(from)} to ${hourName(to)}`;
}

/** A reading's moment, such as "Thu 2:15 PM". */
export const readingName = (at: number): string =>
  `${weekday(at)} ${new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

export const percent = (n: number): string => `${Math.round(n)}%`;

/** How much of a meter is drawn filled, 0-100. */
export function filled(used: number | null): number {
  return Math.min(Math.max(used ?? 0, 0), 100);
}

/** An amount in the currency's minor units, such as 12345 cents, written as money: "$123.45". */
export function money(minor: number, currency: string): string {
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat([], { style: 'currency', currency });
  } catch {
    // A code Intl doesn't know: assume cents, and name the currency.
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(minor / 10 ** digits);
}

export function planName(plan: string): string {
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
}

export function limitName(window: UsageWindow): string {
  if (window.span === 'session') return 'Current session';
  return window.model ? `This week, ${window.model}` : 'This week, all models';
}

/** What's spent of the month's credits, such as "$123.45 of $600.00", or "$123.45 spent, no limit". */
export function spent(credits: UsageCredits): string {
  const spent = credits.spent === null ? '–' : money(credits.spent, credits.currency);
  return credits.limit === null
    ? `${spent} spent, no limit`
    : `${spent} of ${money(credits.limit, credits.currency)}`;
}

/** When the month starts afresh, such as "resets on December 1". */
export function resetsOn(at: number): string {
  return `resets on ${new Date(at).toLocaleDateString([], { month: 'long', day: 'numeric' })}`;
}

/** When the limit resets: today, tomorrow, or on a day this week. */
export function resets(at: number | null): string {
  if (at === null) return '';
  const when = new Date(at);
  const day = (offset: number) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date.toDateString();
  };
  const on =
    when.toDateString() === day(0)
      ? ''
      : when.toDateString() === day(1)
        ? 'tomorrow '
        : `${when.toLocaleDateString([], { weekday: 'long' })} `;
  return `resets ${on}at ${time(at)}`;
}

/** Claude Code's ways of working, as its usage scan names them, in plain words. */
const BEHAVIOURS: Record<string, string> = {
  cache_miss: 'Going on after the prompt cache ran out',
  long_context: 'Long context',
  subagent_heavy: 'Many subagents',
  high_parallel: 'Many chats at once',
  cron: 'Chats left running for hours',
  max_effort: 'Max effort',
  workflow: 'Workflows',
  always_on_context: 'What loads into every chat',
  large_tool_results: 'Large tool results',
};

const SOURCES: Record<UsageSpan['sources'][number]['kind'], string> = {
  agent: 'subagent',
  skill: 'skill',
  plugin: 'plugin',
  mcp: 'MCP server',
};

export function behaviourName(key: string): string {
  return BEHAVIOURS[key] ?? key.replace(/_/g, ' ');
}

export function sourceKind(kind: UsageSpan['sources'][number]['kind']): string {
  return SOURCES[kind];
}

export function modelName(model: string, subagent: boolean): string {
  return subagent ? `Subagents on ${modelLabel(model)}` : modelLabel(model);
}

/** How many times something was used, such as "12 uses". */
export function uses(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'use' : 'uses'}`;
}

/** Its uses against those of the most used in its list, 0-100. */
export function againstMost(used: Used, of: readonly Used[]): number {
  const most = Math.max(0, ...of.map((each) => each.uses));
  return most ? (used.uses / most) * 100 : 0;
}
