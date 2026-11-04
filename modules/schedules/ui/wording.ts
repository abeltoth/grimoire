/** The days of the week, from Monday, as the form lists them; each with its number, 0 for Sunday. */
export const WEEK: readonly { day: number; short: string; long: string }[] = [
  { day: 1, short: 'Mon', long: 'Mondays' },
  { day: 2, short: 'Tue', long: 'Tuesdays' },
  { day: 3, short: 'Wed', long: 'Wednesdays' },
  { day: 4, short: 'Thu', long: 'Thursdays' },
  { day: 5, short: 'Fri', long: 'Fridays' },
  { day: 6, short: 'Sat', long: 'Saturdays' },
  { day: 0, short: 'Sun', long: 'Sundays' },
];

const DAY = 24 * 60 * 60_000;

/** "08:00" as your clock reads it, such as "8:00 AM". */
export function clock(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** When a schedule runs, in words: "Weekdays at 8:00 AM", "Mondays and Thursdays at 9:30 AM". */
export function cadence(days: readonly number[], time: string): string {
  const on = new Set(days);
  const named = WEEK.filter(({ day }) => on.has(day)).map(({ long }) => long);
  const weekdays = [1, 2, 3, 4, 5].every((day) => on.has(day));
  let which: string;
  if (on.size === 7) which = 'Every day';
  else if (on.size === 5 && weekdays) which = 'Weekdays';
  else if (on.size === 2 && on.has(0) && on.has(6)) which = 'Weekends';
  else if (!named.length) return 'On no days';
  else which = named.length === 1 ? named[0]! : `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
  return `${which} at ${clock(time)}`;
}

/** When a run is next, from now: "today at 8:00 AM", "tomorrow at 8:00 AM", "on Monday at 9:00 AM". */
export function upcoming(at: number, now: number): string {
  const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const startOf = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
  const days = Math.round((startOf(at) - startOf(now)) / DAY);
  if (days <= 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  const date = new Date(at);
  const day =
    days < 7
      ? date.toLocaleDateString([], { weekday: 'long' })
      : date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `on ${day} at ${time}`;
}

/** The date a journal entry is headed with: "Wednesday, 4 November". */
export function dateline(at: number): string {
  return new Date(at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

/** When a run was due: "4 Nov, 8:00 AM". */
export function when(at: number): string {
  const date = new Date(at);
  return `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}
