import type { AlwaysAllow, Approval } from '@grimoire/contract';
import { type DiffLine, fileChange } from '../transcript/diff';
import { relativeTo } from '../transcript/rows';

/** What an approval asks for, as the approval card shows it; `asks` is the bare deed, such as "run a command". */
export type Ask =
  | { kind: 'command'; asks: string; command: string; about?: string }
  | { kind: 'file'; asks: string; file: string; path: string; lines: DiffLine[]; about?: string }
  | { kind: 'tool'; asks: string; detail: string; about?: string };

const FILE_ASKS: Record<string, string> = {
  Edit: 'correct this file',
  MultiEdit: 'correct this file',
  Write: 'write this file',
  NotebookEdit: 'correct this notebook',
};

/** Reads an approval: a command to run, a file to change, or another tool to use. */
export function askOf(approval: Approval, cwd?: string): Ask {
  const input = (approval.input ?? {}) as Record<string, unknown>;
  const description = typeof input['description'] === 'string' ? input['description'] : undefined;
  const about = description || approval.title;
  const withAbout = about ? { about } : {};

  if (
    (approval.tool === 'Bash' || approval.tool === 'PowerShell') &&
    typeof input['command'] === 'string'
  ) {
    return {
      kind: 'command',
      asks: 'run a command',
      command: input['command'],
      ...withAbout,
    };
  }
  const change = fileChange(approval.tool, input);
  if (change) {
    return {
      kind: 'file',
      asks: FILE_ASKS[approval.tool]!,
      file: relativeTo(cwd, change.file),
      path: change.file,
      lines: change.lines,
      ...(approval.title ? { about: approval.title } : {}),
    };
  }
  return {
    kind: 'tool',
    asks: `use ${approval.tool}`,
    detail: JSON.stringify(input, null, 2),
    ...withAbout,
  };
}

export function scopeText(
  scope: AlwaysAllow['scope'],
  say: (book: string, plain: string) => string,
): string {
  const scopes: Record<AlwaysAllow['scope'], string> = {
    chat: say('in this chapter', 'in this chat'),
    project: 'in this project',
    everywhere: 'in every project',
  };
  return scopes[scope];
}

/** What Always allow covers: a rule other than the command itself, or else the thing in words, and where. */
export interface AlwaysText {
  rule?: string;
  what?: string;
  scope: string;
}

export function alwaysText(
  always: AlwaysAllow,
  ask: Ask,
  tool: string,
  say: (book: string, plain: string) => string,
): AlwaysText {
  const scope = scopeText(always.scope, say);
  const rule = always.rule?.trim();
  if (rule && !(ask.kind === 'command' && rule === ask.command.trim())) return { rule, scope };
  if (rule) return { what: 'this command', scope };
  return { what: ask.kind === 'file' ? 'edits' : tool, scope };
}
