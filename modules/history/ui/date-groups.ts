import type { ListedChat } from './chat-groups';

/** A stretch of the History by date: the chats last written in during it, newest first. */
export interface DateGroup {
  /** Stays the same while the group does, for tracking it. */
  key: string;
  title: string;
  chats: ListedChat[];
}

const DAY_MS = 86_400_000;

/** The start of the day `at` falls in, in local time. */
function dayOf(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** How many local days before today `at` falls: 0 today, 1 yesterday. */
function daysAgo(at: number, now: number): number {
  return Math.round((dayOf(now) - dayOf(at)) / DAY_MS);
}

/** The stretch a chat last written in at `at` belongs to. */
function groupOf(at: number, now: number): { key: string; title: string } {
  const ago = daysAgo(at, now);
  if (ago <= 0) return { key: 'today', title: 'Today' };
  if (ago === 1) return { key: 'yesterday', title: 'Yesterday' };
  if (ago <= 7) return { key: 'week', title: 'Previous 7 days' };
  if (ago <= 30) return { key: 'month', title: 'Previous 30 days' };
  const date = new Date(at);
  return {
    key: `${date.getFullYear()}-${date.getMonth()}`,
    title: date.toLocaleDateString([], { month: 'long', year: 'numeric' }),
  };
}

/**
 * The chats by when they were last written in, newest first: pinned ones
 * on their own at the top, then today, yesterday, the previous 7 and 30
 * days, and each month before that.
 */
export function byDate(chats: readonly ListedChat[], now: number): DateGroup[] {
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = sorted.filter((chat) => chat.pins.includes('pin'));
  const groups = new Map<string, DateGroup>();
  for (const chat of sorted) {
    if (chat.pins.includes('pin')) continue;
    const { key, title } = groupOf(chat.updatedAt, now);
    const group = groups.get(key) ?? { key, title, chats: [] };
    group.chats.push(chat);
    groups.set(key, group);
  }
  return [
    ...(pinned.length ? [{ key: 'pinned', title: 'Pinned', chats: pinned }] : []),
    ...groups.values(),
  ];
}
