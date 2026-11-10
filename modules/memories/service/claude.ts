import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentMemories, Memory, MemoryFolder } from '@grimoire/contract';
import { claudeHome } from '@grimoire/service/claude/config-dir';
import { readSettingsFile, settingsFilesIn } from '@grimoire/service/claude/settings-files';
import type { MemorySource } from './memories';

/** The memory index's file name in a memory folder. */
export const INDEX = 'MEMORY.md';

/** How long a folder's name may get before Claude Code shortens it and adds a hash. */
const LONGEST = 200;

/**
 * The name Claude Code gives a folder under ~/.claude/projects: every
 * character but letters and digits as "-". A longer one than 200 is cut
 * and given a hash, which isn't worked out here: `known` lists the
 * folders there are, to find it among by its start.
 */
export function projectFolderName(cwd: string, known: readonly string[] = []): string {
  const name = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  if (name.length <= LONGEST) return name;
  const start = `${name.slice(0, LONGEST)}-`;
  return known.find((folder) => folder.startsWith(start)) ?? name.slice(0, LONGEST);
}

/** A memory file's header: its name, description, type and the rest of it, and its text after. */
export function readHeader(text: string): {
  name?: string;
  description?: string;
  type?: string;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { body: text };
  const found: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^\s*([A-Za-z_]+):\s*(.*?)\s*$/.exec(line);
    // A value folded onto the lines below, such as "description: >", isn't read.
    if (!pair || !pair[2] || /^[>|][-+]?$/.test(pair[2])) continue;
    const key = pair[1]!;
    // A key nested under another, such as metadata's type, counts unless the top level has it.
    if (found[key] !== undefined && /^\s/.test(line)) continue;
    found[key] = unquote(pair[2]);
  }
  return {
    ...(found['name'] ? { name: found['name'] } : {}),
    ...(found['description'] ? { description: found['description'] } : {}),
    ...(found['type'] ? { type: found['type'] } : {}),
    body: text.slice(match[0].length),
  };
}

function unquote(value: string): string {
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(value) ?? /^'((?:[^']|'')*)'$/.exec(value);
  if (!quoted) return value;
  return value.startsWith('"')
    ? quoted[1]!.replace(/\\(.)/g, '$1')
    : quoted[1]!.replaceAll("''", "'");
}

/** The memories a text links to with [[name]], or [[name|shown]], in order, each once. */
export function linksIn(text: string): string[] {
  const links: string[] = [];
  for (const match of text.matchAll(/\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]/g)) {
    const name = match[1]!.trim();
    if (name && !links.includes(name)) links.push(name);
  }
  return links;
}

/** The files the memory index lists, with "- [title](file.md)" lines. */
export function indexEntries(text: string): { title: string; file: string }[] {
  const entries: { title: string; file: string }[] = [];
  for (const match of text.matchAll(/^\s*[-*]\s*\[([^\]]*)\]\(([^)\s]+\.md)\)/gm)) {
    entries.push({ title: match[1]!.trim(), file: decodeURIComponent(match[2]!) });
  }
  return entries;
}

/** A memory folder's files, read: each file's name, text and when it changed. */
export interface MemoryFile {
  file: string;
  text: string;
  changedAt: number;
}

/**
 * The memories in a folder, from its files and index: each with its
 * name, kind, links and whether the index lists it, and what's wrong:
 * index lines and links that point at nothing, and memories the index
 * leaves out.
 */
export function toMemories(
  folder: string,
  files: readonly MemoryFile[],
  index: string | undefined,
): { memories: Memory[]; problems: string[] } {
  const entries = index === undefined ? [] : indexEntries(index);
  const listed = new Set(entries.map((entry) => path.basename(entry.file).toLowerCase()));
  const memories = files.map((file): Memory => {
    const header = readHeader(file.text);
    return {
      name: header.name ?? file.file.replace(/\.md$/i, ''),
      path: path.join(folder, file.file),
      ...(header.description ? { description: header.description } : {}),
      type: header.type ?? '',
      changedAt: file.changedAt,
      links: linksIn(header.body),
      indexed: listed.has(file.file.toLowerCase()),
    };
  });

  const known = new Set(
    memories.flatMap((memory) => [memory.name, path.basename(memory.path, '.md')].map(key)),
  );
  const present = new Set(files.map((file) => file.file.toLowerCase()));
  const problems: string[] = [];
  for (const entry of entries) {
    if (!present.has(path.basename(entry.file).toLowerCase())) {
      problems.push(`The index lists ${entry.file}, which doesn’t exist.`);
    }
  }
  for (const memory of memories) {
    for (const link of memory.links) {
      if (!known.has(key(link)))
        problems.push(`${memory.name} links to [[${link}]], which doesn’t exist.`);
    }
  }
  if (index !== undefined) {
    for (const memory of memories) {
      if (!memory.indexed) problems.push(`The index leaves out ${memory.name}.`);
    }
  }
  return { memories, problems };
}

const key = (name: string) => name.trim().toLowerCase();

/** The memory files in a folder, without the index: every ".md" file in it. */
export function readMemoryFiles(folder: string): MemoryFile[] {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.toLowerCase().endsWith('.md') && name !== INDEX)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((name): MemoryFile[] => {
      const file = path.join(folder, name);
      try {
        return [
          { file: name, text: readFileSync(file, 'utf8'), changedAt: statSync(file).mtimeMs },
        ];
      } catch {
        return [];
      }
    });
}

/** What the settings say about memory: whether it's on, and where it's kept instead of the usual folder. */
export interface MemorySettings {
  enabled: boolean;
  directory?: string;
}

/**
 * Memory as Claude Code's settings files set it, later ones winning:
 * your settings, the project's, your own for the project, then the
 * managed ones. The project's settings can't move the memory folder.
 */
export function memorySettings(
  files: readonly { source: 'user' | 'project' | 'local' | 'managed'; settings?: unknown }[],
  home: string,
): MemorySettings {
  let enabled = true;
  let directory: string | undefined;
  for (const { source, settings } of files) {
    const own =
      settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {};
    if (typeof own['autoMemoryEnabled'] === 'boolean') enabled = own['autoMemoryEnabled'];
    const moved = own['autoMemoryDirectory'];
    if (source !== 'project' && typeof moved === 'string' && moved.trim()) {
      directory =
        moved.startsWith('~/') || moved.startsWith('~\\') ? path.join(home, moved.slice(2)) : moved;
    }
  }
  return { enabled, ...(directory ? { directory } : {}) };
}

/** The folder a project folder's chats ran in, from the start of its newest chat file; null when none tells. */
function cwdOf(projectFolder: string): string | null {
  let chats: { name: string; at: number }[];
  try {
    chats = readdirSync(projectFolder)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => ({ name, at: statSync(path.join(projectFolder, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
  } catch {
    return null;
  }
  for (const { name } of chats.slice(0, 3)) {
    let handle: number | undefined;
    try {
      handle = openSync(path.join(projectFolder, name), 'r');
      const buffer = Buffer.alloc(64 * 1024);
      const read = readSync(handle, buffer, 0, buffer.length, 0);
      const cwd = /"cwd":\s*"((?:[^"\\]|\\.)*)"/.exec(buffer.toString('utf8', 0, read));
      if (cwd) return JSON.parse(`"${cwd[1]}"`) as string;
    } catch {
      // Try the next chat.
    } finally {
      if (handle !== undefined) closeSync(handle);
    }
  }
  return null;
}

/** The other folders whose memories Claude Code keeps under ~/.claude/projects, most memories first. */
export function memoryFoldersIn(projects: string, except: string): MemoryFolder[] {
  let names: string[];
  try {
    names = readdirSync(projects);
  } catch {
    return [];
  }
  return names
    .filter((name) => path.resolve(projects, name, 'memory') !== path.resolve(except))
    .map((name) => ({ name, count: readMemoryCount(path.join(projects, name, 'memory')) }))
    .filter(({ count }) => count > 0)
    .map(({ name, count }) => ({ cwd: cwdOf(path.join(projects, name)), count }))
    .sort((a, b) => b.count - a.count);
}

function readMemoryCount(folder: string): number {
  try {
    return readdirSync(folder).filter(
      (name) => name.toLowerCase().endsWith('.md') && name !== INDEX,
    ).length;
  } catch {
    return 0;
  }
}

/** Everything about the memories Claude Code keeps for a folder. */
export function readMemories(input: {
  cwd: string;
  /** Where Claude Code keeps your chats and their memories: ~/.claude, or the profile's folder. */
  claudeFolder: string;
  settings: MemorySettings;
  at: number;
}): AgentMemories {
  const projects = path.join(input.claudeFolder, 'projects');
  let known: string[] = [];
  try {
    known = readdirSync(projects);
  } catch {
    // No projects yet.
  }
  const folder =
    input.settings.directory ?? path.join(projects, projectFolderName(input.cwd, known), 'memory');
  const indexPath = path.join(folder, INDEX);
  const indexExists = existsSync(indexPath);
  let index: string | undefined;
  try {
    if (indexExists) index = readFileSync(indexPath, 'utf8');
  } catch {
    // Read as missing.
  }
  const { memories, problems } = toMemories(folder, readMemoryFiles(folder), index);
  return {
    cwd: input.cwd,
    folder,
    index: { path: indexPath, exists: indexExists },
    enabled: input.settings.enabled,
    memories,
    problems,
    elsewhere: memoryFoldersIn(projects, folder),
    at: input.at,
  };
}

/** The memories Claude Code keeps on its own for a folder, where its settings say. */
export const claudeMemories: MemorySource = {
  read: async (cwd) => {
    const claudeFolder = claudeHome();
    const settings = settingsFilesIn(cwd, claudeFolder, process.platform).map((file) =>
      readSettingsFile(file),
    );
    return readMemories({
      cwd,
      claudeFolder,
      settings: memorySettings(
        settings.flatMap(({ source, settings: own }) =>
          source === 'plugin' ? [] : [{ source, settings: own }],
        ),
        homedir(),
      ),
      at: Date.now(),
    });
  },
};
