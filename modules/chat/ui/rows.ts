import type { Enclosure, Entry, HookRun, TokenUse, ToolBlock } from '@grimoire/contract';
import { weightOf } from '@ui/app/core/tokens';
import { type DiffLine, type FileChange, fileChange } from './diff';

/** What a margin note folds out: a file's corrections or what a tool printed. */
export type Fold =
  | { kind: 'corrections'; file: string; path: string; lines: DiffLine[] }
  | { kind: 'output'; title: string; text: string };

/** What a tool did, to sum up a run of notes. */
export type Deed =
  | 'changed'
  | 'read'
  | 'ran'
  | 'searched'
  | 'fetched'
  | 'searched-web'
  | 'helped'
  | 'asked'
  | 'added'
  | 'other';

/** A margin note: a tool the agent used, marked like a footnote. */
export interface Note {
  key: string;
  mark: string;
  verb: string;
  /** The file, command or search in full. */
  target: string;
  /** What the note's one line shows of it: a file's name, or the target itself. */
  label: string;
  did: Deed;
  running: boolean;
  failed: boolean;
  /** Lines added and removed, such as "+24 −3", when the tool changed a file. */
  counts?: string;
  added?: number;
  removed?: number;
  /** The change was undone. */
  withdrawn?: boolean;
  /** The details, folded out only when you ask. */
  fold?: Fold;
  /** The tool call, when it handed a task to a helper, whose run can be shown on its own page. */
  helper?: ToolBlock;
}

/** A run of notes, summed up on one line that folds out to them. */
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
interface Margin {
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
      enclosures: readonly Enclosure[];
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

/** What a turn spent: by model, and weighed; `costly` for one of the chapter's costliest. */
export interface TurnSpent {
  uses: readonly TokenUse[];
  weight: number;
  costly: boolean;
}

/** The hooks run on a turn, counted up on its closing line, which folds out to them. */
export interface HookLog {
  key: string;
  runs: readonly HookRun[];
  running: number;
  blocked: number;
  failed: number;
}

/** How many of a chapter's turns are marked its costliest, once it has more than that. */
const COSTLIEST = 3;

const MARKS = ['*', '†', '‡', '§', '‖', '¶'];

// The plan shows in the Outline; ToolSearch only loads other tools.
const UNNOTED_TOOLS = new Set([
  'TaskCreate',
  'TaskUpdate',
  'TaskGet',
  'TaskList',
  'TodoWrite',
  'ToolSearch',
]);

/** The tool Grimoire gives the agent to add a task to your Kanban board with; its input's `title` names it. */
const ADD_TODO_TOOL = 'mcp__grimoire__add_todo';

/** The tool a helper ends its run with: its report, in its input's `message`, reads as its last reply. */
const HANDBACK_TOOL = 'SubagentHandback';

/** A helper's report, when the tool call hands one back. */
function handbackOf(block: ToolBlock): string | undefined {
  const message = (block.input as { message?: unknown } | undefined)?.message;
  return block.tool === HANDBACK_TOOL && typeof message === 'string' ? message : undefined;
}

/** Your entries whose edits were undone, and those a fork copied, which can't be. */
export interface UndoMarks {
  withdrawn?: ReadonlySet<string>;
  copied?: ReadonlySet<string>;
}

/**
 * Lays out a transcript: your entries, the agent's replies, and its tools as
 * margin notes. The file changes made after a withdrawn entry are marked so.
 */
export function toRows(
  entries: readonly Entry[],
  cwd?: string,
  { withdrawn = new Set(), copied = new Set() }: UndoMarks = {},
): Row[] {
  const rows: Row[] = [];
  let pending: Note[] = [];
  let marks = 0;
  let bylined = false;
  let undone = false;
  let spent: Extract<Row, { kind: 'spent' }> | undefined;

  /** Closes the turn: what it took and spent shows once it ended, after its last row, and its hooks as they run. */
  const flushSpent = () => {
    if (spent) rows.push(spent);
    spent = undefined;
  };

  const flushNotes = () => {
    if (pending.length)
      rows.push({ kind: 'notes', key: `${pending[0]!.key}/notes`, ...margin(pending) });
    pending = [];
  };

  for (const entry of entries) {
    if (entry.kind === 'user') {
      flushNotes();
      flushSpent();
      if (entry.took !== undefined || entry.hooks?.length) {
        spent = {
          kind: 'spent',
          key: `${entry.id}/spent`,
          ...(entry.took !== undefined ? { took: entry.took } : {}),
          ...(entry.took !== undefined && entry.tokens?.uses.length
            ? {
                tokens: {
                  uses: entry.tokens.uses,
                  weight: weightOf(entry.tokens.uses),
                  costly: false,
                },
              }
            : {}),
          ...(entry.hooks?.length ? { hooks: hookLog(`${entry.id}/hooks`, entry.hooks) } : {}),
        };
      }
      rows.push({
        kind: 'you',
        key: entry.id,
        text: entry.text,
        enclosures: entry.enclosures ?? [],
        ...(entry.at ? { at: entry.at } : {}),
        withdrawn: withdrawn.has(entry.id),
        undoable: false,
      });
      undone = withdrawn.has(entry.id);
      marks = 0;
      bylined = false;
      continue;
    }
    entry.blocks.forEach((block, i) => {
      const key = `${entry.id}/${i}`;
      const report = block.kind === 'tool' ? handbackOf(block) : undefined;
      if (block.kind === 'tool' && report === undefined) {
        if (UNNOTED_TOOLS.has(block.tool)) return;
        const note = toNote(
          key,
          block,
          MARKS[marks % MARKS.length]!.repeat(1 + Math.floor(marks / MARKS.length)),
          cwd,
        );
        pending.push(undone && note.counts ? { ...note, withdrawn: true } : note);
        marks++;
      } else if (block.kind === 'thinking') {
        rows.push({ kind: 'thinking', key, text: block.text });
      } else {
        rows.push({
          kind: 'reply',
          key,
          text: report ?? (block.kind === 'text' ? block.text : ''),
          byline: !bylined,
          ...(entry.at ? { at: entry.at } : {}),
          ...margin(pending),
        });
        pending = [];
        bylined = true;
      }
    });
  }
  flushNotes();
  flushSpent();
  markUndoable(rows, copied);
  markCostliest(rows);
  return rows;
}

/** Marks the turns that weighed most, once there are more turns than that to tell them from. */
function markCostliest(rows: Row[]): void {
  const spent = rows.flatMap((row) => (row.kind === 'spent' && row.tokens ? [row.tokens] : []));
  if (spent.length <= COSTLIEST) return;
  for (const tokens of [...spent].sort((a, b) => b.weight - a.weight).slice(0, COSTLIEST))
    tokens.costly = true;
}

function hookLog(key: string, runs: readonly HookRun[]): HookLog {
  const counted = (outcome: HookRun['outcome']) => runs.filter((run) => run.outcome === outcome).length;
  return { key, runs, running: counted('running'), blocked: counted('blocked'), failed: counted('failed') };
}

function margin(notes: Note[]): Margin {
  return notes.length > 1 ? { notes, summary: summarize(notes) } : { notes };
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const DEEDS: Record<Deed, (n: number) => string> = {
  changed: (n) => `changed ${count(n, 'file', 'files')}`,
  read: (n) => `read ${count(n, 'file', 'files')}`,
  ran: (n) => `ran ${count(n, 'command', 'commands')}`,
  searched: (n) => `searched ${times(n)}`,
  fetched: (n) => `fetched ${count(n, 'page', 'pages')}`,
  'searched-web': (n) => `searched the web ${times(n)}`,
  helped: (n) => `asked ${count(n, 'helper', 'helpers')}`,
  asked: (n) => `asked you ${times(n)}`,
  added: (n) => `added ${count(n, 'task', 'tasks')} to the board`,
  other: (n) => `used ${count(n, 'other tool', 'other tools')}`,
};

/** Sums up a run of notes, in the order the agent first did each thing; a file counts once. */
export function summarize(notes: readonly Note[]): Summary {
  const done = new Map<Deed, Set<string>>();
  notes.forEach((note, i) => {
    const each = done.get(note.did) ?? new Set<string>();
    const file = note.did === 'changed' || note.did === 'read';
    done.set(note.did, each.add(file ? note.target : String(i)));
  });
  const text = [...done].map(([deed, each]) => DEEDS[deed](each.size)).join(', ');
  const changes = notes.filter((note) => note.added !== undefined);
  const standing = changes.filter((note) => !note.withdrawn);
  const total = (lines: 'added' | 'removed') =>
    standing.reduce((sum, note) => sum + (note[lines] ?? 0), 0);
  return {
    key: `${notes[0]!.key}/all`,
    text: text.charAt(0).toUpperCase() + text.slice(1),
    ...(standing.length ? { counts: `+${total('added')} −${total('removed')}` } : {}),
    running: notes.some((note) => note.running),
    failed: notes.filter((note) => note.failed).length,
    withdrawn: changes.length > 0 && !standing.length,
  };
}

/** Undo goes on your entries from which files were changed and not undone yet. */
function markUndoable(rows: Row[], copied: ReadonlySet<string>): void {
  let changesAfter = false;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.kind === 'you') {
      rows[i] = { ...row, undoable: changesAfter && !row.withdrawn && !copied.has(row.key) };
    } else if (row.kind === 'reply' || row.kind === 'notes') {
      changesAfter ||= row.notes.some((note) => note.counts && !note.withdrawn);
    }
  }
}

function toNote(key: string, block: ToolBlock, mark: string, cwd?: string): Note {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const text = (name: string) => (typeof input[name] === 'string' ? (input[name] as string) : '');
  const file = (name: string) => relativeTo(cwd, text(name));
  const [verb, target, did] = describe(block.tool, text, file, resumes(block));
  return {
    key,
    mark,
    verb,
    target,
    label: did === 'changed' || did === 'read' ? nameOf(target) : target,
    did,
    running: !block.result,
    failed: block.result?.isError === true,
    ...detailsOf(block, target || verb, cwd),
    ...(did === 'helped' ? { helper: block } : {}),
  };
}

/** Diffs are worked out once per tool call, not each time the reply grows. */
const changes = new WeakMap<ToolBlock, FileChange | null>();

function detailsOf(
  block: ToolBlock,
  title: string,
  cwd?: string,
): Pick<Note, 'counts' | 'added' | 'removed' | 'fold'> {
  if (!changes.has(block)) changes.set(block, fileChange(block.tool, block.input) ?? null);
  const change = changes.get(block);
  // A change that failed wasn't made; what the tool said about it is what counts.
  if (change && !block.result?.isError) {
    const count = (kind: DiffLine['kind']) => change.lines.filter((l) => l.kind === kind).length;
    const [added, removed] = [count('inserted'), count('removed')];
    return {
      counts: `+${added} −${removed}`,
      added,
      removed,
      fold: {
        kind: 'corrections',
        file: relativeTo(cwd, change.file),
        path: change.file,
        lines: change.lines,
      },
    };
  }
  return block.result?.text ? { fold: { kind: 'output', title, text: block.result.text } } : {};
}

/**
 * Whether a SendMessage call resumed a helper, as its result says; until it
 * has one, it's taken to. A message to another of your sessions resumes none.
 */
function resumes(block: ToolBlock): boolean {
  return !block.result || /"resumedAgentId"/.test(block.result.text);
}

function describe(
  tool: string,
  text: (name: string) => string,
  file: (name: string) => string,
  resumed: boolean,
): [string, string, Deed] {
  switch (tool) {
    case 'Read':
      return ['Read', file('file_path'), 'read'];
    case 'Write':
      return ['Wrote', file('file_path'), 'changed'];
    case 'Edit':
    case 'MultiEdit':
      return ['Edited', file('file_path'), 'changed'];
    case 'NotebookEdit':
      return ['Edited', file('notebook_path'), 'changed'];
    case 'Bash':
    case 'PowerShell':
      return ['Ran', text('command'), 'ran'];
    case 'Grep':
      return ['Searched', text('pattern'), 'searched'];
    case 'Glob':
      return ['Looked for', text('pattern'), 'searched'];
    case 'WebFetch':
      return ['Fetched', text('url'), 'fetched'];
    case 'WebSearch':
      return ['Searched the web', text('query'), 'searched-web'];
    case 'Task':
    case 'Agent':
      return ['Asked a helper', text('description'), 'helped'];
    case 'SendMessage':
      return resumed ? ['Messaged a helper', text('summary') || text('to'), 'helped'] : [tool, '', 'other'];
    case 'AskUserQuestion':
      return ['Asked you', '', 'asked'];
    case ADD_TODO_TOOL:
      return ['Added to the board', text('title').trim(), 'added'];
    default:
      return [tool, '', 'other'];
  }
}

/** The last part of a path: the file's name. */
function nameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** A path inside the chapter's folder, written relative to it. */
export function relativeTo(cwd: string | undefined, file: string): string {
  if (!cwd || !file) return file;
  const normalize = (p: string) => p.replaceAll('\\', '/');
  const base = normalize(cwd).replace(/\/$/, '') + '/';
  const path = normalize(file);
  return path.toLowerCase().startsWith(base.toLowerCase()) ? path.slice(base.length) : file;
}
