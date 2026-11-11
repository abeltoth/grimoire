import type { DiffLine } from '@grimoire/contract';

export type { DiffLine };

// Beyond this many line pairs the diff gives up on matching lines and shows
// the old text struck and the new text inserted.
const MAX_CELLS = 4_000_000;

/** The lines that stay, go and come between two texts, by longest common subsequence. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ kind: 'removed' as const, text })),
      ...b.map((text) => ({ kind: 'inserted' as const, text })),
    ];
  }

  // common[i][j]: the longest common subsequence of a[i..] and b[j..].
  const width = b.length + 1;
  const common = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i * width + j] =
        a[i] === b[j]
          ? common[(i + 1) * width + j + 1]! + 1
          : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i++]! });
      j++;
    } else if (
      j < b.length &&
      // On a tie, what goes is listed before what comes.
      (i === a.length || common[i * width + j + 1]! > common[(i + 1) * width + j]!)
    ) {
      lines.push({ kind: 'inserted', text: b[j++]! });
    } else {
      lines.push({ kind: 'removed', text: a[i++]! });
    }
  }
  return lines;
}

/** A text's lines; the newline that ends the last line doesn't start another. */
function linesOf(text: string): string[] {
  return text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
}

/** A file the agent wants to change, and how. */
export interface FileChange {
  file: string;
  lines: DiffLine[];
}

/** The change a file tool would make, when the tool is one that changes files. */
export function fileChange(tool: string, input: unknown): FileChange | undefined {
  const fields = (input ?? {}) as Record<string, unknown>;
  const text = (name: string) => (typeof fields[name] === 'string' ? (fields[name] as string) : '');
  switch (tool) {
    case 'Edit':
      return { file: text('file_path'), lines: diffLines(text('old_string'), text('new_string')) };
    case 'MultiEdit': {
      const edits = Array.isArray(fields['edits'])
        ? (fields['edits'] as Record<string, unknown>[])
        : [];
      return {
        file: text('file_path'),
        lines: edits.flatMap((edit) =>
          diffLines(String(edit['old_string'] ?? ''), String(edit['new_string'] ?? '')),
        ),
      };
    }
    case 'Write':
      return { file: text('file_path'), lines: diffLines('', text('content')) };
    case 'NotebookEdit':
      return { file: text('notebook_path'), lines: diffLines('', text('new_source')) };
    default:
      return undefined;
  }
}
