import type { TokenCounts, TokenSource, TokenUse } from '@grimoire/contract';
import { addTokens } from '@grimoire/contract';
import type { ApiMessage, ClaudeMessage } from './messages';
import { costOf } from './prices';

/** A turn's replies' tokens by API message ID; Claude Code repeats a reply's on each of its blocks. */
export type Spent = Map<string, TokenUse>;

/** The model Claude Code names on notes of its own, which no model wrote. */
export const SYNTHETIC_MODEL = '<synthetic>';

/**
 * What a reply was made under, as Claude Code notes it: its subagent, or
 * outside one its skill, never both.
 */
export function sourceOf(message: ClaudeMessage): TokenSource | undefined {
  if (message.attributionAgent) return { kind: 'subagent', name: message.attributionAgent };
  if (message.attributionSkill) return { kind: 'skill', name: message.attributionSkill };
  return undefined;
}

/** A reply's tokens; undefined for one with none, such as Claude Code's own notes. */
export function tokenUse(
  message: ApiMessage,
  subagent: boolean,
  source: TokenSource | undefined,
): TokenUse | undefined {
  const usage = message.usage;
  if (!usage || !message.model || message.model === SYNTHETIC_MODEL) return undefined;
  const long = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const counts: TokenCounts = {
    input: usage.input_tokens ?? 0,
    cacheWritten: Math.max((usage.cache_creation_input_tokens ?? 0) - long, 0),
    cacheWrittenLong: long,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
  };
  if (!Object.values(counts).some((n) => n > 0)) return undefined;
  const cost = costOf(message.model, counts);
  return {
    model: message.model,
    ...(subagent ? { subagent } : {}),
    ...(source ? { source } : {}),
    ...counts,
    ...(cost ? { cost } : {}),
  };
}

/** A turn's tokens added up by model, the chat's own apart from its subagents', and each skill's apart. */
export function byModel(spent: Spent): TokenUse[] {
  const uses = new Map<string, TokenUse>();
  for (const use of spent.values()) {
    const under = use.source ? ` ${use.source.kind} ${use.source.name}` : '';
    const key = `${use.subagent ? 'subagent' : 'chat'} ${use.model}${under}`;
    const sum = uses.get(key);
    if (!sum) uses.set(key, { ...use });
    else {
      // One model's replies are all priced, or none of them.
      const cost = sum.cost && use.cost ? { cost: addTokens([sum.cost, use.cost]) } : {};
      uses.set(key, { ...sum, ...addTokens([sum, use]), ...cost });
    }
  }
  return [...uses.values()];
}
