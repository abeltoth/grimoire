import type { ChatSummary } from '@grimoire/contract';

/** A part of the History: one project's chats. */
export interface Part {
  /** The project's folder, as its newest chat names it. */
  folder: string;
  chats: ChatSummary[];
}

/** A worktree Grimoire or Claude Code made, and anything inside it: <repo>/.claude/worktrees/<name>. */
const WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/][^\\/]+(?:[\\/].*)?$/;

/** The project a chat's folder belongs to: a worktree's is its repository's. */
export function projectOf(folder: string): string {
  return folder.replace(WORKTREE, '');
}

/** One folder however it's written: either separator, a trailing one, a Windows drive in either case. */
function keyOf(folder: string): string {
  const key = folder.replaceAll('\\', '/').replace(/(.)\/+$/, '$1');
  return /^[a-z]:/i.test(key) ? key.toLowerCase() : key;
}

const pinned = (chat: ChatSummary) => Number(chat.pins.includes('pin'));

/**
 * The chats as parts, one per project, the part with the newest chat
 * first. In each part pinned chats come first, then the newest. A chat
 * without a folder ran in your home folder.
 */
export function partsOf(chats: readonly ChatSummary[], home: string): Part[] {
  const parts = new Map<string, Part & { newest: number }>();
  for (const chat of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const folder = projectOf(chat.cwd ?? home);
    const key = keyOf(folder);
    const part = parts.get(key) ?? { folder, chats: [], newest: chat.updatedAt };
    part.chats.push(chat);
    parts.set(key, part);
  }
  return [...parts.values()]
    .sort((a, b) => b.newest - a.newest)
    .map(({ folder, chats }) => ({
      folder,
      chats: chats.sort((a, b) => pinned(b) - pinned(a)),
    }));
}

/** A part's title: its project's folder name, or "Home folder". */
export function partTitle(folder: string, home: string): string {
  if (!folder || keyOf(folder) === keyOf(home)) return 'Home folder';
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}

/** A part's number, in Roman numerals: 1 is I, 14 is XIV. */
export function numeral(n: number): string {
  const steps: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rest = n;
  let written = '';
  for (const [value, letters] of steps) {
    for (; rest >= value; rest -= value) written += letters;
  }
  return written;
}

const fold = (tag: string) => tag.toLowerCase();

/** Every tag the chats have, each once whatever its case, in alphabetical order. */
export function tagsOf(chats: readonly ChatSummary[]): string[] {
  const seen = new Map<string, string>();
  for (const tag of chats.flatMap((chat) => chat.tags)) {
    if (!seen.has(fold(tag))) seen.set(fold(tag), tag);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** The chats that have every one of these tags, whatever their case. */
export function withTags(chats: readonly ChatSummary[], tags: readonly string[]): ChatSummary[] {
  const wanted = tags.map(fold);
  return chats.filter((chat) => {
    const has = new Set(chat.tags.map(fold));
    return wanted.every((tag) => has.has(tag));
  });
}

/** Tags as they're kept: trimmed, without blanks, each once whatever its case. */
export function keptTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag && !seen.has(fold(tag)) && seen.add(fold(tag)));
}

/** When a chat was last written in: the time today, the day this year, else the day and year. */
export function dated(at: number, now = Date.now()): string {
  const when = new Date(at);
  const today = new Date(now);
  if (when.toDateString() === today.toDateString()) {
    return when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return when.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(when.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}
