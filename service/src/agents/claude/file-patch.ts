import type { DiffHunk } from '@grimoire/contract';

/**
 * What a finished file tool changed, from the structured result Claude Code
 * reports with it: the patch of an edit or a write over a file, or a
 * notebook cell's old and new source. Undefined for any other result, and
 * for a new file, whose content the tool's input already shows.
 */
export function hunksOf(result: unknown): DiffHunk[] | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const fields = result as Record<string, unknown>;
  const patch = fields['structuredPatch'];
  if (Array.isArray(patch)) {
    const hunks = patch.flatMap(hunkOf);
    return hunks.length ? hunks : undefined;
  }
  if (typeof fields['new_source'] === 'string' && typeof fields['cell_type'] === 'string')
    return cellHunk(
      typeof fields['old_source'] === 'string' ? fields['old_source'] : '',
      fields['new_source'],
    );
  return undefined;
}

function hunkOf(part: unknown): DiffHunk[] {
  const fields = (part ?? {}) as Record<string, unknown>;
  const { oldStart, newStart, lines } = fields;
  if (typeof oldStart !== 'number' || typeof newStart !== 'number' || !Array.isArray(lines))
    return [];
  return [{ oldStart, newStart, lines: lines.filter((line) => typeof line === 'string') }];
}

/** A cell's change: its source as it was, then as it is, its unchanged lines at either end kept as they are. */
function cellHunk(before: string, after: string): DiffHunk[] | undefined {
  const old = before === '' ? [] : before.split(/\r?\n/);
  const now = after === '' ? [] : after.split(/\r?\n/);
  let head = 0;
  while (head < old.length && head < now.length && old[head] === now[head]) head++;
  let tail = 0;
  while (
    tail < old.length - head &&
    tail < now.length - head &&
    old[old.length - 1 - tail] === now[now.length - 1 - tail]
  )
    tail++;
  if (head === old.length && head === now.length) return undefined;
  return [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        ...old.slice(0, head).map((line) => ` ${line}`),
        ...old.slice(head, old.length - tail).map((line) => `-${line}`),
        ...now.slice(head, now.length - tail).map((line) => `+${line}`),
        ...now.slice(now.length - tail).map((line) => ` ${line}`),
      ],
    },
  ];
}
