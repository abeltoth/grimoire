import { type AgentModels, type ChatSettings, fitEffort } from '@grimoire/contract';
import type { Rating } from './subagents';

/** The longest stretch of a first message the rater reads. */
const MESSAGE_CHARS = 4_000;

/** Tells the rater what it's for; the chat's first message follows as the user message. */
export const AUTO_PROMPT = `You read the first message of a chat with Claude Code, a coding agent, to pick the model and effort that will do the work well at the least cost.

Models, cheapest first:
- haiku: questions with short answers, quick lookups, small edits spelled out in full.
- sonnet: most coding: features and fixes across a few files, debugging with a clear lead, reviews, tests.
- opus: hard reasoning: design, large or unclear changes, subtle bugs, open-ended research, anything where a mistake is costly.

Effort, lowest first: low, medium, high, xhigh, max.

When torn between two, pick the stronger.

Answer with only a JSON object, such as {"model": "sonnet", "effort": "medium"}.`;

/** The first message as the rater reads it, cut short. */
export function messageForRater(text: string): string {
  return text.length > MESSAGE_CHARS ? `${text.slice(0, MESSAGE_CHARS)}…` : text;
}

/**
 * The rating as a chat's settings: the model's alias, at the effort nearest
 * the rating it takes. Undefined when the agent doesn't offer the model.
 */
export function autoPick(
  rating: Rating,
  models: AgentModels,
): Pick<ChatSettings, 'model' | 'effort'> | undefined {
  const model = models.models.find((offered) => offered.id === rating.model);
  if (!model) return undefined;
  const effort = fitEffort(rating.effort, model.efforts ?? []);
  return { model: model.id, ...(effort ? { effort } : {}) };
}
