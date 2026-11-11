import type { NoteChat, NoteDraft } from '@grimoire/contract';
import { z } from 'zod';
import type { AgentTool } from '@grimoire/service/core/module';

/** What the agent is told of the tool, in its system prompt. */
export const ADD_NOTE_PROMPT =
  "Grimoire, the app this chat is in, gives you the tool add_note, which saves a short note in the user's " +
  'notes, with a reminder when a time is given. Call it only when the user asks for a note or a reminder.';

const DESCRIPTION =
  "Save a short note in the user's notes, linking back to this chat, with an optional one-off reminder " +
  'that shows in the app at the time given. Use it only when the user asks for a note or a reminder.';

const INPUT = {
  text: z.string().describe('What the note says, in markdown; its first line names it'),
  remindAt: z
    .string()
    .optional()
    .describe(
      "When to remind the user, as an ISO 8601 date and time, such as 2026-11-14T09:00; in the user's " +
        'local time when it has no offset. Leave it out for a note without a reminder.',
    ),
};

/** Saves a new note in the notes in use, noting the chat it was made in; throws when the notes turn it away. */
export type AddNote = (draft: Omit<NoteDraft, 'id'>, madeIn: NoteChat) => void;

/** The time a reminder is set for, from the ISO 8601 the agent gave, in ms since the epoch. */
export function reminderTime(iso: string): number {
  const at = Date.parse(iso.trim());
  if (Number.isNaN(at))
    throw new Error(`"${iso}" isn't a date and time; give one such as 2026-11-14T09:00.`);
  return at;
}

/** The tool that lets the agent save a note, with an optional reminder, linking back to its chat. */
export function addNoteTool(add: AddNote): AgentTool<typeof INPUT> {
  return {
    name: 'add_note',
    description: DESCRIPTION,
    prompt: ADD_NOTE_PROMPT,
    input: INPUT,
    run({ text, remindAt }, madeIn) {
      if (!madeIn) throw new Error('There is no chat to add the note in yet.');
      const at = remindAt?.trim() ? reminderTime(remindAt) : undefined;
      add(
        { text: text.trim(), pinned: false, ...(at !== undefined ? { remindAt: at } : {}) },
        madeIn,
      );
      return at === undefined
        ? "Saved the note in the user's notes."
        : `Saved the note in the user's notes, with a reminder at ${new Date(at).toLocaleString()}.`;
    },
  };
}
