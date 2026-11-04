/** "08:00": hours from 00 to 23, then minutes. */
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The days and time a schedule runs on, in local time. */
export interface When {
  days: readonly number[];
  time: string;
}

export function isTime(time: string): boolean {
  return TIME.test(time);
}

/** When on the day `offset` days after the one `from` falls on, the schedule's time is. */
function onDay(from: number, offset: number, time: string): number {
  const [, hours, minutes] = TIME.exec(time) ?? [];
  const day = new Date(from);
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + offset,
    Number(hours),
    Number(minutes),
  ).getTime();
}

/** The first time after `after` the schedule is due; null when it names no days. */
export function nextDue({ days, time }: When, after: number): number | null {
  if (!days.length || !isTime(time)) return null;
  for (let offset = 0; offset <= 7; offset++) {
    const at = onDay(after, offset, time);
    if (at > after && days.includes(new Date(at).getDay())) return at;
  }
  return null;
}

/**
 * The times the schedule was due after `after` and up to `until`, oldest
 * first, going back no further than `lookBack` before `until`.
 */
export function dueTimes({ days, time }: When, after: number, until: number, lookBack: number): number[] {
  if (!days.length || !isTime(time)) return [];
  const from = Math.max(after, until - lookBack);
  const due: number[] = [];
  for (let offset = 0; ; offset++) {
    const at = onDay(from, offset, time);
    if (at > until) return due;
    if (at > from && days.includes(new Date(at).getDay())) due.push(at);
  }
}
