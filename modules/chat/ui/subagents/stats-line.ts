import type { SubagentStats } from '@grimoire/contract';
import { tokenCount } from '@ui/app/core/tokens';
import { duration } from '../transcript/duration';

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** What a subagent's run took, as its page's foot reads: "6m 17s · 165.9K tokens · 41 tool calls · +183 −5". */
export function statsLine(stats: SubagentStats): string {
  const { durationMs, tokens, toolUses, lines } = stats;
  return [
    durationMs !== undefined ? duration(durationMs) : '',
    tokens !== undefined ? `${tokenCount(tokens)} tokens` : '',
    toolUses !== undefined ? plural(toolUses, 'tool call') : '',
    lines && (lines.added || lines.removed) ? `+${lines.added} −${lines.removed}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Its tool calls by kind, those it made: "3 reads, 32 shell commands, 5 edits"; empty until it ended. */
export function toolsInWords(stats: SubagentStats): string {
  const tools = stats.tools;
  if (!tools) return '';
  return [
    tools.read ? plural(tools.read, 'read') : '',
    tools.search ? plural(tools.search, 'search', 'searches') : '',
    tools.shell ? plural(tools.shell, 'shell command') : '',
    tools.edit ? plural(tools.edit, 'edit') : '',
    tools.other ? plural(tools.other, 'other tool call') : '',
  ]
    .filter(Boolean)
    .join(', ');
}
