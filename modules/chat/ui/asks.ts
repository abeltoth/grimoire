import type { AlwaysAllow, Approval } from '@grimoire/contract';
import { type DiffLine, fileChange } from './diff';
import { relativeTo } from './rows';

/** What an approval asks for, as the approval card shows it. */
export type Ask =
  | { kind: 'command'; asks: string; command: string; about?: string }
  | { kind: 'file'; asks: string; file: string; path: string; lines: DiffLine[]; about?: string }
  | { kind: 'tool'; asks: string; detail: string; about?: string };

const FILE_ASKS: Record<string, string> = {
  Edit: 'asks to correct this file',
  MultiEdit: 'asks to correct this file',
  Write: 'asks to write this file',
  NotebookEdit: 'asks to correct this notebook',
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
      asks: 'asks to run this command',
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
    asks: `asks to use ${approval.tool}`,
    detail: JSON.stringify(input, null, 2),
    ...withAbout,
  };
}

export function scopeText(scope: AlwaysAllow['scope'], say: (book: string, plain: string) => string): string {
  const scopes: Record<AlwaysAllow['scope'], string> = {
    chat: say('in this chapter', 'in this chat'),
    project: 'in this project',
    everywhere: 'in every project',
  };
  return scopes[scope];
}
