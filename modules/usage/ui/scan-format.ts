import type { UsageSpan } from '@grimoire/contract';

type Advice = UsageSpan['advice'][number];
type Source = UsageSpan['sources'][number];

/**
 * Why Claude Code gives a tip about a way of working, from its share of the
 * usage, in plain words: what its scan counts in each, as its own code does.
 */
const WAYS: Record<string, (share: string) => string> = {
  cache_miss: (share) => `${share} of your usage was in requests after the prompt cache ran out`,
  long_context: (share) => `${share} of your usage was in requests past 150K tokens of context`,
  subagent_heavy: (share) => `${share} of your usage was in chats that leaned on subagents`,
  high_parallel: (share) => `${share} of your usage was while 4 or more chats ran at once`,
  cron: (share) => `${share} of your usage was in chats active over 8 or more hours`,
  max_effort: (share) => `${share} of your usage was at max effort`,
  workflow: (share) => `${share} of your usage was in workflows`,
  always_on_context: (share) => `${share} of your usage went to what loads at every chat’s start`,
  large_tool_results: (share) => `${share} of your usage went to tool results over 10K tokens`,
};

/** The tips about one subagent, skill, plugin or MCP server, by the kind of source they name. */
const SOURCES: Record<string, { kind: Source['kind']; took: (name: string) => string }> = {
  agent: { kind: 'agent', took: (name) => `${name} subagents took` },
  skill: { kind: 'skill', took: (name) => `/${name} took` },
  plugin: { kind: 'plugin', took: (name) => `The ${name} plugin took` },
  mcp_server: { kind: 'mcp', took: (name) => `The ${name} MCP server took` },
};

/**
 * Why Claude Code gives a tip, such as "/commit took 15% of your usage";
 * undefined for a tip Grimoire doesn't know. A tip about a source is about
 * the one of its kind with the tip's share, the largest when none has it.
 */
export function tipReason(advice: Advice, span: UsageSpan): string | undefined {
  const share = `${Math.round(advice.share)}%`;
  const way = WAYS[advice.key];
  if (way) return way(share);
  const source = SOURCES[advice.key];
  if (!source) return undefined;
  const ofKind = span.sources.filter((each) => each.kind === source.kind);
  const named = ofKind.find((each) => each.share === advice.share) ?? ofKind[0];
  return named ? `${source.took(named.name)} ${share} of your usage` : undefined;
}

/** The command a tip gives, such as "/clear" from "run /clear"; undefined when it says something else. */
export function tipCommand(detail: string | undefined): string | undefined {
  return detail?.match(/^(?:run )?(\/\S.*)$/)?.[1];
}
