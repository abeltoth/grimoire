import type { AgentId, ChatId } from '@grimoire/contract';

/**
 * Notes: short loose thoughts, each with an optional one-off reminder
 * (ADR-009: Grimoire's own data). Each profile has notes of its own.
 */

/** The chat a note was made in, by its agent: to open it again. */
export interface NoteChat {
  chatId: ChatId;
  agent: AgentId;
  /** The folder the chat works in. */
  cwd: string;
}

export interface Note {
  id: string;
  /** What the note says, in markdown. */
  text: string;
  /** When it was made, in ms since the epoch. */
  createdAt: number;
  /** A pinned note shows above the others. */
  pinned: boolean;
  /** When to be reminded of it, in ms since the epoch; missing when there's no reminder. */
  remindAt?: number;
  /** Whether its reminder's time has come and it isn't done. */
  due: boolean;
  /** When it was marked done; missing while it isn't. */
  doneAt?: number;
  /** The chat whose agent made it, when one did. */
  madeIn?: NoteChat;
}

/** A note as you write it: a new one has no ID yet; leaving `remindAt` out clears its reminder. */
export interface NoteDraft {
  id?: string;
  text: string;
  pinned: boolean;
  remindAt?: number;
}

declare module '@grimoire/contract' {
  interface CommandMap {
    /** Every note, done ones too, newest first. */
    'notes.list': { request: Record<string, never>; response: Note[] };
    /** Saves a note's text, pin and reminder; a new one when it has no ID. Returns them all. */
    'notes.save': { request: NoteDraft; response: Note[] };
    /** Marks a note done, which ends its reminder, or not done again. Returns them all. */
    'notes.done': { request: { id: string; done: boolean }; response: Note[] };
    /** Deletes a note. Returns the rest. */
    'notes.remove': { request: { id: string }; response: Note[] };
  }
}

declare module '@grimoire/contract' {
  interface EventMap {
    /** The notes, after one was saved, done or removed, or a reminder came due. */
    'notes.changed': { notes: Note[] };
  }
}
