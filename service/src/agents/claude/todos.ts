import path from 'node:path';
import type { CardChat, CardDraft } from '@grimoire/contract';
import { z } from 'zod';
import type { ServerMaker } from './grimoire-tools';

/**
 * The tool on Grimoire's own tool server (grimoire-tools.ts) that lets the
 * agent add a task to your Kanban board, as a card at the foot of To do
 * that links back to the chat it was added in: its own name.
 */
export const ADD_TODO_TOOL_NAME = 'add_todo';

/** The tool as Claude Code calls it, after the server. */
export const ADD_TODO_TOOL = 'mcp__grimoire__add_todo';

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

/** The chat a card is added in, as a card links back to it. */
export type MadeIn = Omit<CardChat, 'at'>;

/** Adds a new card to the board in use, noting the chat it was added in; throws when the board turns it away. */
export type AddTodo = (draft: Omit<CardDraft, 'id'>, madeIn: MadeIn) => void;

/** The chat a process's tool adds cards in: a spare process's, once a chat claims it. */
export class TodoChat {
  private chat: MadeIn | undefined;

  get(): MadeIn | undefined {
    return this.chat;
  }

  set(chat: MadeIn): void {
    this.chat = chat;
  }
}

/**
 * The tool, adding cards in `chat` with `add`; always loaded, never
 * deferred behind tool search. A folder that isn't absolute is taken
 * from the chat's.
 */
export function addTodoTool(sdk: ServerMaker, chat: TodoChat, add: AddTodo) {
  return sdk.tool(
    ADD_TODO_TOOL_NAME,
    DESCRIPTION,
    INPUT,
    async ({ title, notes, folder }) => {
      const madeIn = chat.get();
      if (!madeIn) return failed('There is no chat to add the task in yet.');
      const named = folder?.trim();
      const draft = {
        title: title.trim(),
        notes: notes?.trim() ?? '',
        cwd: !named ? madeIn.cwd : path.isAbsolute(named) ? named : path.resolve(madeIn.cwd, named),
      };
      try {
        add(draft, madeIn);
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error));
      }
      return {
        content: [
          { type: 'text', text: `Added "${draft.title}" to To do on the user's Kanban board.` },
        ],
      };
    },
    { alwaysLoad: true },
  );
}

function failed(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}
