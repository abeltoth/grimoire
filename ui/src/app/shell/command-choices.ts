import type { AgentCommand, AgentModels, CommandChoice, EffortLevel } from '@grimoire/contract';
import type { Chat } from '../core/chat';

/** A choice as the command palette shows it. */
export interface Choice extends CommandChoice {
  label: string;
}

/** What the effort of a chat's model can be set to, and is now. */
export interface Efforts {
  levels: readonly EffortLevel[];
  level?: EffortLevel;
}

/**
 * The values a command takes, with the one set now: for what Grimoire keeps
 * itself, the chat's own settings say; for the rest, the agent.
 */
export function choicesOf(
  command: AgentCommand,
  chat: Chat,
  models: AgentModels | undefined,
  efforts: Efforts,
): Choice[] {
  const mark = (value: string, now: string | undefined) =>
    value === now ? { current: true as const } : {};
  switch (command.owner) {
    case 'model': {
      const now = chat.settings.model ?? models?.default;
      return (models?.models ?? []).map((model) => ({
        value: model.id,
        label: model.name,
        ...(model.description ? { description: model.description } : {}),
        ...mark(model.id, now),
      }));
    }
    case 'effort':
      return efforts.levels.map((level) => ({
        value: level,
        label: level,
        ...mark(level, efforts.level),
      }));
    default:
      return (command.choices ?? []).map((choice) => ({ ...choice, label: choice.value }));
  }
}
