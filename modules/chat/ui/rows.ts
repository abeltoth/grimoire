import type { Entry, ToolBlock } from '@grimoire/contract';
import { type DiffLine, type FileChange, fileChange } from './diff';

/** What a margin note folds out: a file's corrections or what a tool printed. */
export type Fold =
  | { kind: 'corrections'; file: string; lines: DiffLine[] }
  | { kind: 'output'; title: string; text: string };

/** A margin note: a tool the agent used, marked like a footnote. */
export interface Note {
  key: string;
  mark: string;
  verb: string;
  target: string;
  running: boolean;
  failed: boolean;
  /** Lines added and removed, such as "+24 −3", when the tool changed a file. */
  counts?: string;
  /** The details, folded out only when you ask. */
  fold?: Fold;
}

/**
 * One line of the transcript's grid: the text column and, beside it in
 * the margin, the notes for the tools the agent used before writing it.
 */
export type Row =
  | { kind: 'you'; key: string; text: string; at?: number }
  | { kind: 'thinking'; key: string; text: string }
  | { kind: 'reply'; key: string; text: string; byline: boolean; at?: number; notes: Note[] }
  | { kind: 'notes'; key: string; notes: Note[] };

const MARKS = ['*', '†', '‡', '§', '‖', '¶'];

/** Lays out a transcript: your entries, the agent's replies, and its tools as margin notes. */
export function toRows(entries: readonly Entry[], cwd?: string): Row[] {
  const rows: Row[] = [];
  let pending: Note[] = [];
  let marks = 0;
  let bylined = false;

  const flushNotes = () => {
    if (pending.length)
      rows.push({ kind: 'notes', key: `${pending[0]!.key}/notes`, notes: pending });
    pending = [];
  };

  for (const entry of entries) {
    if (entry.kind === 'user') {
      flushNotes();
      rows.push({
        kind: 'you',
        key: entry.id,
        text: entry.text,
        ...(entry.at ? { at: entry.at } : {}),
      });
      marks = 0;
      bylined = false;
      continue;
    }
    entry.blocks.forEach((block, i) => {
      const key = `${entry.id}/${i}`;
      if (block.kind === 'tool') {
        pending.push(
          toNote(
            key,
            block,
            MARKS[marks % MARKS.length]!.repeat(1 + Math.floor(marks / MARKS.length)),
            cwd,
          ),
        );
        marks++;
      } else if (block.kind === 'thinking') {
        rows.push({ kind: 'thinking', key, text: block.text });
      } else {
        rows.push({
          kind: 'reply',
          key,
          text: block.text,
          byline: !bylined,
          ...(entry.at ? { at: entry.at } : {}),
          notes: pending,
        });
        pending = [];
        bylined = true;
      }
    });
  }
  flushNotes();
  return rows;
}

function toNote(key: string, block: ToolBlock, mark: string, cwd?: string): Note {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const text = (name: string) => (typeof input[name] === 'string' ? (input[name] as string) : '');
  const file = (name: string) => relativeTo(cwd, text(name));
  const [verb, target] = describe(block.tool, text, file);
  return {
    key,
    mark,
    verb,
    target,
    running: !block.result,
    failed: block.result?.isError === true,
    ...detailsOf(block, target || verb, cwd),
  };
}

/** Diffs are worked out once per tool call, not each time the reply grows. */
const changes = new WeakMap<ToolBlock, FileChange | null>();

function detailsOf(block: ToolBlock, title: string, cwd?: string): Pick<Note, 'counts' | 'fold'> {
  if (!changes.has(block)) changes.set(block, fileChange(block.tool, block.input) ?? null);
  const change = changes.get(block);
  // A change that failed wasn't made; what the tool said about it is what counts.
  if (change && !block.result?.isError) {
    const count = (kind: DiffLine['kind']) => change.lines.filter((l) => l.kind === kind).length;
    return {
      counts: `+${count('inserted')} −${count('removed')}`,
      fold: { kind: 'corrections', file: relativeTo(cwd, change.file), lines: change.lines },
    };
  }
  return block.result?.text ? { fold: { kind: 'output', title, text: block.result.text } } : {};
}

function describe(
  tool: string,
  text: (name: string) => string,
  file: (name: string) => string,
): [string, string] {
  switch (tool) {
    case 'Read':
      return ['Read', file('file_path')];
    case 'Write':
      return ['Wrote', file('file_path')];
    case 'Edit':
    case 'MultiEdit':
      return ['Edited', file('file_path')];
    case 'NotebookEdit':
      return ['Edited', file('notebook_path')];
    case 'Bash':
    case 'PowerShell':
      return ['Ran', text('command')];
    case 'Grep':
      return ['Searched', text('pattern')];
    case 'Glob':
      return ['Looked for', text('pattern')];
    case 'WebFetch':
      return ['Fetched', text('url')];
    case 'WebSearch':
      return ['Searched the web', text('query')];
    case 'Task':
    case 'Agent':
      return ['Asked a helper', text('description')];
    case 'TodoWrite':
      return ['Updated the plan', ''];
    case 'AskUserQuestion':
      return ['Asked you', ''];
    default:
      return [tool, ''];
  }
}

/** A path inside the chapter's folder, written relative to it. */
export function relativeTo(cwd: string | undefined, file: string): string {
  if (!cwd || !file) return file;
  const normalize = (p: string) => p.replaceAll('\\', '/');
  const base = normalize(cwd).replace(/\/$/, '') + '/';
  const path = normalize(file);
  return path.toLowerCase().startsWith(base.toLowerCase()) ? path.slice(base.length) : file;
}
