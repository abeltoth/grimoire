/** The hour a reminder for tomorrow is set at. */
const MORNING = 9;

const time = (at: Date) => at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** When a reminder is, in your local time: "today at 09:00", "tomorrow at 09:00", or "Fri 14 Nov at 09:00". */
export function whenLabel(at: number, now: number): string {
  const day = new Date(at);
  const today = new Date(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (day.toDateString() === today.toDateString()) return `today at ${time(day)}`;
  if (day.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time(day)}`;
  const date = day.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${date} at ${time(day)}`;
}

/** An hour from now, to the minute. */
export function inAnHour(now: number): number {
  const at = new Date(now + 60 * 60_000);
  at.setSeconds(0, 0);
  return at.getTime();
}

/** Tomorrow morning, at MORNING o'clock. */
export function tomorrowMorning(now: number): number {
  const today = new Date(now);
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, MORNING).getTime();
}

/** A moment as a datetime-local field shows it: "2026-11-14T09:00", in your local time. */
export function toInput(at: number): string {
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** What a datetime-local field holds, as a moment; undefined when it's empty or not a time. */
export function fromInput(value: string): number | undefined {
  if (!value) return undefined;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? undefined : at;
}
