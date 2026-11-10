import type { Memory } from '@grimoire/contract';

/** A column of the map: the memories of one kind. */
export interface Column {
  type: string;
  title: string;
  memories: Memory[];
}

/** A link drawn between two cards, in the map's own coordinates. */
export interface Line {
  from: string;
  to: string;
  d: string;
  /** Where it arrives, marked with a dot. */
  x: number;
  y: number;
}

/** The memories an open one links to, the links that name none, and those that link to it. */
export interface Related {
  to: Memory[];
  missing: string[];
  from: Memory[];
}

/** The kinds in the order their columns stand; any other follows, then those that don't say. */
const KINDS: Record<string, string> = {
  user: 'About you',
  feedback: 'Feedback',
  project: 'Projects',
  reference: 'References',
};

const key = (name: string) => name.trim().toLowerCase();

/** The memory a [[link]] names: by its name, or its file's. */
export function resolve(memories: readonly Memory[], link: string): Memory | undefined {
  const wanted = key(link);
  return memories.find(
    (memory) =>
      key(memory.name) === wanted ||
      key(memory.path.split(/[\\/]/).at(-1)!.replace(/\.md$/i, '')) === wanted,
  );
}

/** The links of a memory that name no memory. */
export function missing(memories: readonly Memory[], memory: Memory): string[] {
  return memory.links.filter((link) => !resolve(memories, link));
}

/** What the memory at this path links with, either way; nothing when it isn't among them. */
export function related(memories: readonly Memory[], path: string | undefined): Related {
  const memory = memories.find((one) => one.path === path);
  if (!memory) return { to: [], missing: [], from: [] };
  const to = [...new Set(memory.links.flatMap((link) => resolve(memories, link) ?? []))].filter(
    (one) => one !== memory,
  );
  const from = memories.filter(
    (one) => one !== memory && one.links.some((link) => resolve(memories, link) === memory),
  );
  return { to, missing: missing(memories, memory), from };
}

/** A kind as its column is titled. */
export function kindOf(type: string): string {
  return KINDS[type] ?? (type ? `${type.charAt(0).toUpperCase()}${type.slice(1)}` : 'Other');
}

/** The memories in columns by kind, in the kinds' order. */
export function columns(memories: readonly Memory[]): Column[] {
  const order = Object.keys(KINDS);
  const types = [...new Set(memories.map((memory) => memory.type))].sort((a, b) => {
    const rank = (type: string) =>
      type === '' ? order.length + 1 : order.includes(type) ? order.indexOf(type) : order.length;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return types.map((type) => ({
    type,
    title: kindOf(type),
    memories: memories.filter((memory) => memory.type === type),
  }));
}

/**
 * A curve from one card's side to another's: across the gap between their
 * columns, or out and back along their right sides when they share one.
 */
export function curve(
  a: DOMRect,
  b: DOMRect,
  origin: DOMRect,
): { d: string; x: number; y: number } {
  const ay = a.top + a.height / 2 - origin.top;
  const by = b.top + b.height / 2 - origin.top;
  const sameColumn = Math.abs(a.left - b.left) < 1;
  if (sameColumn) {
    const ax = a.right - origin.left;
    const bx = b.right - origin.left;
    const out = Math.max(ax, bx) + Math.min(40, Math.abs(by - ay) / 3 + 12);
    return { d: `M ${ax} ${ay} C ${out} ${ay}, ${out} ${by}, ${bx} ${by}`, x: bx, y: by };
  }
  const rightward = b.left > a.left;
  const ax = (rightward ? a.right : a.left) - origin.left;
  const bx = (rightward ? b.left : b.right) - origin.left;
  const mid = (ax + bx) / 2;
  return { d: `M ${ax} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${bx} ${by}`, x: bx, y: by };
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
