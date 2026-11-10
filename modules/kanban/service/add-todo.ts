import path from 'node:path';
import type { CardDraft } from '@grimoire/contract';
import { z } from 'zod';
import type { AgentTool, ToolChat } from '@grimoire/service/core/module';

/** What the agent is told of the tool, in its system prompt. */
export const ADD_TODO_PROMPT =
  "Grimoire, the app this chat is in, gives you the tool add_todo, which puts a task on the user's " +
  'Kanban board. Call it only when the user asks for a to-do, or when a clearly separate task comes up ' +
  'that should be tracked.';

const DESCRIPTION =
  "Add a task to the user's Kanban board, as a card at the foot of To do that links back to this chat. " +
  'Use it only when the user asks for a to-do, or when a clearly separate task comes up that should be ' +
  'tracked; never for the steps of the current task.';

const INPUT = {
  title: z.string().describe('A few words naming the task'),
  notes: z
    .string()
    .optional()
    .describe('More about the task: what someone picking it up needs to know'),
  folder: z
    .string()
    .optional()
    .describe("The project folder the task is in; this chat's folder when left out"),
};

/** Adds a new card to the board in use, noting the chat it was added in; throws when the board turns it away. */
export type AddTodo = (draft: Omit<CardDraft, 'id'>, madeIn: ToolChat) => void;

/**
 * The tool that lets the agent add a task to your Kanban board, as a card
 * at the foot of To do that links back to the chat it was added in. A
 * folder that isn't absolute is taken from the chat's.
 */
export function addTodoTool(add: AddTodo): AgentTool<typeof INPUT> {
  return {
    name: 'add_todo',
    description: DESCRIPTION,
    prompt: ADD_TODO_PROMPT,
    input: INPUT,
    run({ title, notes, folder }, madeIn) {
      if (!madeIn) throw new Error('There is no chat to add the task in yet.');
      const named = folder?.trim();
      const draft = {
        title: title.trim(),
        notes: notes?.trim() ?? '',
        cwd: !named ? madeIn.cwd : path.isAbsolute(named) ? named : path.resolve(madeIn.cwd, named),
      };
      add(draft, madeIn);
      return `Added "${draft.title}" to To do on the user's Kanban board.`;
    },
  };
}
