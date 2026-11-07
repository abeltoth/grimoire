import { EFFORT_LEVELS, fitEffort, type AgentModels, type EffortLevel } from '@grimoire/contract';

/** The models a subagent can be given, cheapest first. */
export const TIERS = ['haiku', 'sonnet', 'opus'] as const;
export type Tier = (typeof TIERS)[number];

/** What the rater says a subagent's task needs. */
export interface Rating {
  model: Tier;
  effort: EffortLevel;
}

/** The parts of the Agent tool's input the picker reads. */
export interface AgentToolInput {
  description?: string;
  prompt?: string;
  subagent_type?: string;
  model?: string;
  effort?: string;
}

/** A subagent Claude Code knows of, and the model its definition names, if any. */
export interface SubagentDefinition {
  name: string;
  model?: string;
}

/** The longest stretch of a task's prompt the rater reads. */
const PROMPT_CHARS = 4_000;

/** Tells the rater what it's for; the task follows as the message. */
export const RATER_PROMPT = `You rate a task that Claude Code is about to hand to a subagent, to pick the cheapest model and effort that will still do it well.

Models, cheapest first:
- haiku: quick lookups, finding and reading files, listing or summing up what's there, small edits spelled out in full.
- sonnet: most coding: changes across a few files, debugging with a clear lead, reviews, tests.
- opus: hard reasoning: design, subtle or unclear bugs, open-ended research, anything where a mistake is costly.

Effort, lowest first: low, medium, high, xhigh, max.

Pick a cheaper model or a lower effort only when the task is clearly easy. When in doubt, pick opus at high effort.

Answer with only a JSON object, such as {"model": "haiku", "effort": "low"}.`;

/** The task as the rater reads it: its kind of subagent, its description, and its prompt, cut short. */
export function taskForRater(input: AgentToolInput): string {
  const prompt = input.prompt ?? '';
  return [
    `Subagent: ${input.subagent_type || 'general-purpose'}`,
    `Task: ${input.description ?? ''}`,
    '',
    prompt.length > PROMPT_CHARS ? `${prompt.slice(0, PROMPT_CHARS)}…` : prompt,
  ].join('\n');
}

/** The rater's answer read; undefined when it isn't a model and an effort. */
export function readRating(text: string): Rating | undefined {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return undefined;
  try {
    const { model, effort } = JSON.parse(json) as { model?: unknown; effort?: unknown };
    return TIERS.includes(model as Tier) && EFFORT_LEVELS.includes(effort as EffortLevel)
      ? { model: model as Tier, effort: effort as EffortLevel }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Which of the three a model is, by its alias or ID; undefined for any other. */
export function tierOf(model: string | undefined): Tier | undefined {
  return TIERS.find((tier) => model?.toLowerCase().includes(tier));
}

/**
 * Whether a subagent's model is someone else's to say: named in the call,
 * in its definition, or by CLAUDE_CODE_SUBAGENT_MODEL; and a fork always
 * runs as the chat does.
 */
export function modelIsSet(
  input: AgentToolInput,
  definitions: readonly SubagentDefinition[],
  env: Record<string, string | undefined>,
): boolean {
  if (input.model || input.effort || input.subagent_type === 'fork') return true;
  if (env['CLAUDE_CODE_SUBAGENT_MODEL']) return true;
  const type = input.subagent_type || 'general-purpose';
  const own = definitions.find((definition) => definition.name === type)?.model;
  return !!own && own !== 'inherit';
}

/** The model and effort a chat runs at, as its settings and the agent's models say. */
export interface ChatModel {
  tier: Tier;
  effort?: EffortLevel;
}

/** The model and effort a chat runs at; undefined when its model isn't one of the three. */
export function chatModelOf(
  settings: { model?: string; effort?: EffortLevel },
  models: AgentModels,
): ChatModel | undefined {
  const id = settings.model ?? models.default;
  const tier = tierOf(id);
  if (!tier) return undefined;
  const effort = settings.effort ?? models.models.find((model) => model.id === id)?.effort;
  return { tier, ...(effort ? { effort } : {}) };
}

/**
 * What to give the subagent from the rating: only ever cheaper than the
 * chat runs, a cheaper model or, on the same one, a lower effort, and never
 * a higher effort than the chat's. Undefined when the rating would make it
 * no cheaper.
 */
export function cheaperPick(
  rating: Rating,
  chat: ChatModel,
  models: AgentModels,
): { model?: Tier; effort?: EffortLevel } | undefined {
  const rank = (level: EffortLevel) => EFFORT_LEVELS.indexOf(level);
  const capped =
    chat.effort && rank(rating.effort) > rank(chat.effort) ? chat.effort : rating.effort;
  const efforts = models.models.find((model) => model.id === rating.model)?.efforts ?? [];
  const effort = fitEffort(capped, efforts);
  if (TIERS.indexOf(rating.model) < TIERS.indexOf(chat.tier))
    return { model: rating.model, ...(effort ? { effort } : {}) };
  if (rating.model !== chat.tier || !chat.effort || !effort) return undefined;
  return rank(effort) < rank(chat.effort) ? { effort } : undefined;
}

/** What picking a subagent's model needs of its chat and the agent. */
export interface PickerSources {
  /** The chat's model and effort as they are now. */
  settings(): { model?: string; effort?: EffortLevel };
  models(): Promise<AgentModels>;
  /** The subagents Claude Code knows of in the chat's folder. */
  definitions(): Promise<readonly SubagentDefinition[]>;
  /** Asks the rater about a task; resolves with what it answered. */
  rate(task: string, signal: AbortSignal): Promise<string>;
  env: Record<string, string | undefined>;
}

/**
 * The Agent tool's input with a cheaper model or effort for its task, as
 * the rater judges it; undefined when it's left as Claude Code would run it.
 */
export async function pickFor(
  input: AgentToolInput,
  sources: PickerSources,
  signal: AbortSignal,
): Promise<AgentToolInput | undefined> {
  const definitions = await sources.definitions().catch(() => []);
  if (modelIsSet(input, definitions, sources.env)) return undefined;
  const models = await sources.models();
  const chat = chatModelOf(sources.settings(), models);
  // Nothing runs cheaper than Haiku at its lowest effort: no need to ask.
  if (!chat || (chat.tier === 'haiku' && (!chat.effort || chat.effort === 'low'))) return undefined;
  const rating = readRating(await sources.rate(taskForRater(input), signal));
  const pick = rating && cheaperPick(rating, chat, models);
  return pick ? { ...input, ...pick } : undefined;
}
