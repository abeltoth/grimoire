import type { AgentCapability, AgentId, ChatSummary } from '@grimoire/contract';
import { SUGGEST_PROMPT, readSuggestions, titlesText } from './prompt';

/** What suggesting tags needs of the agents, through the hub. */
export interface SuggestSources {
  agents(): readonly { id: AgentId; capabilities: readonly AgentCapability[] }[];
  listChats(agent: AgentId): Promise<ChatSummary[]>;
  ask(agent: AgentId, instructions: string, text: string, signal: AbortSignal): Promise<string>;
}

/** How long the model may take to suggest tags. */
const SUGGEST_TIMEOUT_MS = 60_000;

/**
 * Tags that would sort your chats, as the first agent that answers
 * prompts suggests them from the titles of its agents' chats, newest
 * first; none when no agent can say.
 */
export async function suggestTags(sources: SuggestSources): Promise<string[]> {
  const askers = sources
    .agents()
    .filter((agent) => agent.capabilities.includes('ask'))
    .map((agent) => agent.id);
  const agent = askers[0];
  if (!agent) return [];
  const lists = await Promise.all(askers.map((asker) => sources.listChats(asker).catch(() => [])));
  const chats = lists.flat().sort((a, b) => b.updatedAt - a.updatedAt);
  const answer = await sources.ask(
    agent,
    SUGGEST_PROMPT,
    titlesText(chats.map((chat) => chat.title)),
    AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
  );
  return readSuggestions(answer);
}
