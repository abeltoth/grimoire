import path from 'node:path';
import type { Attachment, FileAttachment } from '@grimoire/contract';

/** One file reference on a line of its own: @"src/app.ts", or @src/app.ts as typed in a terminal. */
const REFERENCE = /^@(?:"([^"]+)"|(\S+))$/;

/**
 * Your message as Claude Code takes it: the files you attached as @-references
 * on lines of their own after the text, which Claude Code reads in with the
 * message. Files inside the chat's folder are named relative to it.
 */
export function withReferences(text: string, attachments: readonly Attachment[], cwd: string): string {
  const references = attachments
    .filter((attachment): attachment is FileAttachment => attachment.kind === 'file')
    .map(({ path: file }) => `@"${named(file, cwd)}"`);
  return [text, references.join('\n')].filter(Boolean).join('\n\n');
}

/** Splits the @-references on the last lines of a message back off its text. */
export function splitReferences(message: string): { text: string; files: FileAttachment[] } {
  const lines = message.trimEnd().split('\n');
  const files: FileAttachment[] = [];
  while (lines.length) {
    const match = REFERENCE.exec(lines.at(-1)!.trim());
    if (!match) break;
    files.unshift({ kind: 'file', path: (match[1] ?? match[2])! });
    lines.pop();
  }
  return { text: lines.join('\n').trimEnd(), files };
}

function named(file: string, cwd: string): string {
  const relative = path.relative(cwd, file);
  const inside = relative && !relative.startsWith('..') && !path.isAbsolute(relative);
  return inside ? relative.split(path.sep).join('/') : file;
}
