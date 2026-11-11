import type { Entry, HookRun, ToolBlock } from '@grimoire/contract';
import { weightOf } from '@ui/app/core/tokens';
import { deedOf } from '../composer/commands';
import { type DiffLine, type FileChange, fileChange } from './diff';
import type { Deed, HookLog, Note, Row } from './row';
import { margin } from './summary';

/** How many of a chat's turns are marked its costliest, once it has more than that. */
const COSTLIEST = 3;

// The plan shows in the Plan; ToolSearch only loads other tools.
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

/** The tool a subagent ends its run with: its report, in its input's `message`, reads as its last reply. */
const HANDBACK_TOOL = 'SubagentHandback';

/** A subagent's report, when the tool call hands one back. */
function handbackOf(block: ToolBlock): string | undefined {
  const message = (block.input as { message?: unknown } | undefined)?.message;
  return block.tool === HANDBACK_TOOL && typeof message === 'string' ? message : undefined;
}

/** Your messages whose edits were undone, and those a fork copied, which can't be. */
export interface UndoMarks {
  withdrawn?: ReadonlySet<string>;
  copied?: ReadonlySet<string>;
}

/**
 * Lays out a transcript: your messages, the agent's replies, and its tools as
 * tool notes. The file changes made after a withdrawn entry are marked so.
 */
export function toRows(
  entries: readonly Entry[],
  cwd?: string,
  { withdrawn = new Set(), copied = new Set() }: UndoMarks = {},
): Row[] {
  const rows: Row[] = [];
  let pending: Note[] = [];
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
        attachments: entry.attachments ?? [],
        ...(entry.at ? { at: entry.at } : {}),
        withdrawn: withdrawn.has(entry.id),
        undoable: false,
      });
      undone = withdrawn.has(entry.id);
      bylined = false;
      continue;
    }
    if (entry.kind === 'compaction') {
      flushNotes();
      const { kind: _, id, ...compaction } = entry;
      rows.push({ kind: 'compaction', key: id, ...compaction });
      bylined = false;
      continue;
    }
    entry.blocks.forEach((block, i) => {
      const key = `${entry.id}/${i}`;
      const report = block.kind === 'tool' ? handbackOf(block) : undefined;
      if (block.kind === 'tool' && report === undefined) {
        if (UNNOTED_TOOLS.has(block.tool)) return;
        const note = toNote(key, block, cwd);
        pending.push(undone && note.counts ? { ...note, withdrawn: true } : note);
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
  const counted = (outcome: HookRun['outcome']) =>
    runs.filter((run) => run.outcome === outcome).length;
  return {
    key,
    runs,
    running: counted('running'),
    blocked: counted('blocked'),
    failed: counted('failed'),
  };
}

/** Undo goes on your messages from which files were changed and not undone yet. */
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

function toNote(key: string, block: ToolBlock, cwd?: string): Note {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const text = (name: string) => (typeof input[name] === 'string' ? (input[name] as string) : '');
  const file = (name: string) => relativeTo(cwd, text(name));
  const [verb, target, did] = describe(block.tool, text, file, resumes(block));
  const shell = SHELL_TOOLS.has(block.tool);
  const description = shell ? text('description').trim() : '';
  const named = !shell && (did === 'changed' || did === 'read');
  return {
    key,
    verb,
    target,
    label: named ? nameOf(target) : description || target,
    ...(description ? { described: true } : {}),
    did,
    running: !block.result,
    failed: block.result?.isError === true,
    ...detailsOf(block, shell ? commandTitle(target, description) : { title: target || verb }, cwd),
    ...(did === 'helped' ? { subagent: block } : {}),
  };
}

/** Diffs are worked out once per tool call, not each time the reply grows. */
const changes = new WeakMap<ToolBlock, FileChange | null>();

/** The tools that run a command line. */
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/** A command's output is headed by what it does, or its one short line; the command in full goes above the output. */
function commandTitle(command: string, description: string): { title: string; command?: string } {
  const short = !/\n/.test(command) && command.length <= SHORT_COMMAND;
  if (!description && short) return { title: command };
  return { title: description || 'Command', command };
}

/** The longest command that heads its output by itself. */
const SHORT_COMMAND = 80;

function detailsOf(
  block: ToolBlock,
  { title, command }: { title: string; command?: string },
  cwd?: string,
): Pick<Note, 'counts' | 'added' | 'removed' | 'details'> {
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
      details: {
        kind: 'diff',
        file: relativeTo(cwd, change.file),
        path: change.file,
        lines: change.lines,
      },
    };
  }
  return block.result?.text
    ? {
        details: {
          kind: 'output',
          title,
          text: block.result.text,
          ...(command ? { command } : {}),
        },
      }
    : {};
}

/**
 * Whether a SendMessage call resumed a subagent, as its result says; until it
 * has one, it's taken to. A message to another of your sessions resumes none.
 */
function resumes(block: ToolBlock): boolean {
  return !block.result || /"resumedAgentId"/.test(block.result.text);
}

const COMMAND_VERBS: Record<ReturnType<typeof deedOf>, string> = {
  read: 'Read',
  searched: 'Searched',
  tested: 'Tested',
  committed: 'Committed',
  ran: 'Ran',
};

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
    case 'PowerShell': {
      const deed = deedOf(text('command'));
      return [COMMAND_VERBS[deed], text('command'), deed];
    }
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
      return resumed
        ? ['Messaged a helper', text('summary') || text('to'), 'helped']
        : [tool, '', 'other'];
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

/** A path inside the chat's folder, written relative to it. */
export function relativeTo(cwd: string | undefined, file: string): string {
  if (!cwd || !file) return file;
  const normalize = (p: string) => p.replaceAll('\\', '/');
  const base = normalize(cwd).replace(/\/$/, '') + '/';
  const path = normalize(file);
  return path.toLowerCase().startsWith(base.toLowerCase()) ? path.slice(base.length) : file;
}
