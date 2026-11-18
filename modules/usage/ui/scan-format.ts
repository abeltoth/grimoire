import type { UsageSpan } from '@grimoire/contract';

type SourceKind = UsageSpan['sources'][number]['kind'];

/**
 * Claude Code's ways of working, as its usage scan names them, in plain
 * words, with what it counts in each, as its own code does.
 */
const BEHAVIOURS: Record<string, { name: string; rule: string }> = {
  cache_miss: {
    name: 'Going on after the prompt cache ran out',
    rule: 'A request with over 100K tokens not read from the cache.',
  },
  long_context: { name: 'Long context', rule: 'A request whose context is over 150K tokens.' },
  subagent_heavy: {
    name: 'Many subagents',
    rule: 'A whole chat that made 3 or more subagent requests, or whose subagents took over half of it.',
  },
  high_parallel: {
    name: 'Many chats at once',
    rule: 'A request while 4 or more chats ran in the same 5 minutes.',
  },
  cron: {
    name: 'Chats left running for hours',
    rule: 'A whole chat with requests in 8 or more separate hours.',
  },
  max_effort: { name: 'Max effort', rule: 'A request at max effort.' },
  workflow: { name: 'Workflows', rule: 'A request from a workflow.' },
  always_on_context: {
    name: 'What loads into every chat',
    rule: 'What a chat starts with, when it’s over 40K tokens, in the input of each request.',
  },
  large_tool_results: {
    name: 'Large tool results',
    rule: 'Tool results over 10K tokens, while they stay in the context.',
  },
};

/** The ways of working the scan counts whole chats for, not requests. */
const BY_CHAT = new Set(['subagent_heavy', 'cron']);

const SOURCES: Record<SourceKind, string> = {
  agent: 'subagent',
  skill: 'skill',
  plugin: 'plugin',
  mcp: 'MCP server',
};

/** A way of working's name, or Claude Code's own for one Grimoire doesn't know. */
export function behaviourName(key: string): string {
  return BEHAVIOURS[key]?.name ?? key.replace(/_/g, ' ');
}

/** What the scan counts in a way of working; undefined for one Grimoire doesn't know. */
export function behaviourRule(key: string): string | undefined {
  return BEHAVIOURS[key]?.rule;
}

/** How many requests a way of working was seen in, or chats for those it counts whole. */
export function behaviourCount(key: string, n: number): string {
  return BY_CHAT.has(key) ? counted(n, 'chat', 'chats') : counted(n, 'request', 'requests');
}

export function sourceKind(kind: SourceKind): string {
  return SOURCES[kind];
}

/** A count with its noun, such as "4,002 requests". */
export function counted(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * The plugins and MCP servers that took a share: the scan credits them on
 * top of the chat, a subagent or a skill, so they overlap the cost by skill.
 */
export function overlapping(span: UsageSpan): UsageSpan['sources'] {
  return span.sources.filter((source) => source.kind === 'plugin' || source.kind === 'mcp');
}

/** The command a tip gives, such as "/clear" from "run /clear"; undefined when it says something else. */
export function tipCommand(detail: string | undefined): string | undefined {
  return detail?.match(/^(?:run )?(\/\S.*)$/)?.[1];
}
