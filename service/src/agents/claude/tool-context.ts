import type { Entry, TokenCounts, ToolBlock } from '@grimoire/contract';

/** One of the chat's own calls to the API: its reply's ID, the input it was sent and what it wrote. */
interface Call {
  id: string;
  input: number;
  output: number;
}

/** Every token of input a call was sent, cached or not. */
function inputOf(counts: TokenCounts): number {
  return counts.input + counts.cacheWritten + counts.cacheWrittenLong + counts.cacheRead;
}

/**
 * Puts on each tool result the tokens it added to the chat's context. Each
 * call to the API is sent the chat so far, so it's sent the call before
 * it, that call's reply and what its tools gave back: the difference less
 * the reply is the tools' results, split by their size when there are more.
 * Your own message or a compaction in between leaves the results unknown.
 */
export class ToolContext {
  private last: Call | undefined;

  /** A reply of the chat's own, not a subagent's, with its tokens; Claude Code repeats a reply's on each of its blocks. */
  reply(id: string, counts: TokenCounts, entries: readonly Entry[]): void {
    const call = { id, input: inputOf(counts), output: counts.output };
    if (this.last && this.last.id !== id) settle(this.last, call, entries);
    this.last = call;
  }
}

/** Puts on the tools of `before` what `after` was sent more than it, less `before`'s own reply. */
function settle(before: Call, after: Call, entries: readonly Entry[]): void {
  const at = entries.findLastIndex((entry) => entry.id === before.id);
  const entry = entries[at];
  if (entry?.kind !== 'agent') return;
  if (entries.slice(at + 1).some((later) => later.kind !== 'agent')) return;
  const added = after.input - before.input - before.output;
  const tools = entry.blocks.filter(
    (block): block is ToolBlock & { result: NonNullable<ToolBlock['result']> } =>
      block.kind === 'tool' && !!block.result,
  );
  if (added <= 0 || !tools.length) return;
  const sizes = tools.map((tool) => Math.max(tool.result.text.length, 1));
  const all = sizes.reduce((sum, size) => sum + size, 0);
  let left = added;
  tools.forEach((tool, i) => {
    const share = i === tools.length - 1 ? left : Math.round((added * sizes[i]!) / all);
    tool.result.context = share;
    left -= share;
  });
}
