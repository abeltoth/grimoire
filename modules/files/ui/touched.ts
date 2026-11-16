import type { Entry } from '@grimoire/contract';

/** The files a chat's agent changed, as it named them, the latest first, each once. */
export function touchedFiles(entries: readonly Entry[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (let at = entries.length - 1; at >= 0; at--) {
    const entry = entries[at]!;
    if (entry.kind !== 'agent') continue;
    for (let block = entry.blocks.length - 1; block >= 0; block--) {
      const tool = entry.blocks[block]!;
      const file = tool.kind === 'tool' ? tool.result?.changed : undefined;
      if (!file) continue;
      // The same file may be named with either slash, and in any case on Windows.
      const key = file.replaceAll('\\', '/').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }
  return files;
}

/** A file named in full, from the folder the page shows when it's in it, with forward slashes. */
export function fromFolder(file: string, root: string | null): string {
  const path = file.replaceAll('\\', '/');
  const top = root?.replaceAll('\\', '/').replace(/\/$/, '');
  return top && path.toLowerCase().startsWith(`${top.toLowerCase()}/`)
    ? path.slice(top.length + 1)
    : path;
}
