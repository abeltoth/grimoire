import type { Attachment, HookRun, TokenUse, ToolBlock } from '@grimoire/contract';
import type { DiffLine } from './diff';

/** What a tool note expands: a file's diff or what a tool printed. */
export type NoteDetails =
  | {
      kind: 'diff';
      file: string;
      path: string;
      lines: DiffLine[];
      /** Where each edit after the first begins, when edits in a row to the file are merged. */
      breaks?: number[];
    }
  | {
      kind: 'output';
      title: string;
      text: string;
      /** The command in full, when the title doesn't show it all. */
      command?: string;
    };

/** What a tool did, to sum up a run of notes. */
export type Deed =
  | 'changed'
  | 'read'
  | 'ran'
  | 'tested'
  | 'committed'
  | 'searched'
  | 'fetched'
  | 'searched-web'
  | 'helped'
  | 'asked'
  | 'added'
  | 'other';

/** A tool note: a tool the agent used. */
export interface Note {
  key: string;
  verb: string;
  /** The file, command or search in full. */
  target: string;
  /** What the note's one line shows of it: a file's name, a command's description, or the target itself. */
  label: string;
  /** The label is a command's description, which says what it did: no verb goes before it. */
  described?: boolean;
  /** How many tool calls in a row it stands for, when edits to one file are merged. */
  times?: number;
  did: Deed;
  running: boolean;
  failed: boolean;
  /** Lines added and removed, such as "+24 −3", when the tool changed a file. */
  counts?: string;
  added?: number;
  removed?: number;
  /** The change was undone. */
  withdrawn?: boolean;
  /** The details, expanded only when you ask. */
  details?: NoteDetails;
  /** The tool call, when it handed a task to a subagent, whose run can be shown on its own page. */
  subagent?: ToolBlock;
}

/** A run of notes, summed up on one line that expands to them. */
export interface Summary {
  key: string;
  /** Such as "Read 2 files, changed 3 files, ran 1 command". */
  text: string;
  /** Lines added and removed across the changes still standing. */
  counts?: string;
  running: boolean;
  failed: number;
  /** Every change in the run was undone. */
  withdrawn: boolean;
}

/** The notes beside a row; more than one are summed up. */
export interface Margin {
  notes: Note[];
  summary?: Summary;
}

/**
 * One line of the transcript's grid: the text column and, beside it in
 * the margin, the notes for the tools the agent used before writing it.
 */
export type Row =
  | {
      kind: 'you';
      key: string;
      text: string;
      /** Pictures and files sent with it. */
      attachments: readonly Attachment[];
      at?: number;
      withdrawn: boolean;
      /** Undo would restore something: this turn or a later one changed files, not yet undone. */
      undoable: boolean;
    }
  | { kind: 'thinking'; key: string; text: string }
  | ({ kind: 'reply'; key: string; text: string; byline: boolean; at?: number } & Margin)
  | ({ kind: 'notes'; key: string } & Margin)
  | {
      kind: 'spent';
      key: string;
      /** How long the turn took, once it ended. */
      took?: number;
      /** What the turn spent, once it ended. */
      tokens?: TurnSpent;
      /** The hooks run on the turn, as they run. */
      hooks?: HookLog;
    };

/** What a turn spent: by model, and weighed; `costly` for one of the chat's costliest. */
export interface TurnSpent {
  uses: readonly TokenUse[];
  weight: number;
  costly: boolean;
}

/** The hooks run on a turn, counted up on its closing line, which expands to them. */
export interface HookLog {
  key: string;
  runs: readonly HookRun[];
  running: number;
  blocked: number;
  failed: number;
}
