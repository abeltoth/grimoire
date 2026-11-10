import type { AgentId, ChatId } from './agents';

/**
 * How a chat runs: its model, effort, permissions and folder, for a chat
 * and for one not begun yet.
 */

/** How freely the agent may act: ask first, accept edits, plan only, or allow everything. */
export type ApprovalMode = 'ask' | 'accept-edits' | 'plan' | 'allow-all';

/** How hard the model thinks before it answers, from least to most. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** The level a model runs at when asked for one it doesn't take: the highest it takes below it. */
export function fitEffort(
  level: EffortLevel | undefined,
  levels: readonly EffortLevel[],
): EffortLevel | undefined {
  if (!level || !levels.length) return undefined;
  const asked = EFFORT_LEVELS.indexOf(level);
  return [...levels].reverse().find((taken) => EFFORT_LEVELS.indexOf(taken) <= asked) ?? levels[0];
}

export interface ChatSettings {
  /** The project folder the agent works in. */
  cwd: string;
  /** The agent's model ID; the agent's default when left out. */
  model?: string;
  /** The model's effort; what your agent's own settings give when left out. */
  effort?: EffortLevel;
  /**
   * Auto: the agent picks the model and effort for the chat's first message,
   * whatever is set here. Once the chat has begun, `model` and `effort` say
   * what it picked; picking another model ends Auto.
   */
  autoModel?: boolean;
  mode?: ApprovalMode;
  /**
   * The MCP servers turned off for this chat, by name: they don't start for
   * it, nor take room in its context. Those off in every chat are in
   * Grimoire's settings.
   */
  mcpOff?: string[];
}

/** Settings for a new chat; the folder defaults to your home folder. */
export type NewChatSettings = Omit<ChatSettings, 'cwd'> & { cwd?: string };

/**
 * What a second model's chat comes from: a chat that has begun, or a new
 * chat's settings, with the chat it just began, which edits
 * while the second only reads.
 */
export type ParallelFrom =
  | { chatId: ChatId }
  | { agent: AgentId; settings: NewChatSettings; title?: string; alongside: ChatId };

/**
 * The settings you can change once a chat has begun. Its MCP servers change
 * from its next turn: the agent's process starts again, continuing the chat.
 */
export type SettingsChange = Pick<ChatSettings, 'model' | 'mode' | 'effort' | 'mcpOff'>;
