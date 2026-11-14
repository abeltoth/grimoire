import { type FSWatcher, existsSync, readFileSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ChatEvents } from '../adapter';
import { claudeHome } from './config-dir';
import { readSettingsFile, settingsFilesIn } from './settings-files';

/** How long the files have to stay still before they're read again, in ms. */
const SETTLE_MS = 500;

/** The settings that say which plugins and project MCP servers load. */
const LOADING_KEYS = [
  'enabledPlugins',
  'enabledMcpjsonServers',
  'disabledMcpjsonServers',
  'enableAllProjectMcpServers',
] as const;

/**
 * What a Claude Code process in a folder takes its tools from as it
 * starts, and keeps until it stops: each MCP server's config, by name,
 * and the settings that say which plugins and project servers load.
 */
export interface ToolSources {
  servers: Record<string, string>;
  loading: string;
}

/** Where Claude Code keeps your MCP servers and those of each project: in your Claude folder when it's moved, else your home folder. */
export function claudeJsonPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env['CLAUDE_CONFIG_DIR'] || homedir(), '.claude.json');
}

/** Reads what a process in `cwd` would start its tools from, now; throws while a file is half written. */
export function readToolSources(
  cwd: string,
  claudeFolder: string = claudeHome(),
  claudeJson: string = claudeJsonPath(),
  platform: NodeJS.Platform = process.platform,
): ToolSources {
  const config = readJson(claudeJson);
  const project = projectOf(config['projects'], cwd, platform);
  const servers: Record<string, string> = {};
  const add = (from: unknown) => {
    if (!isObject(from)) return;
    for (const [name, server] of Object.entries(from)) servers[name] = JSON.stringify(server);
  };
  add(config['mcpServers']);
  add(readJson(path.join(cwd, '.mcp.json'))['mcpServers']);
  add(project['mcpServers']);
  const loading = settingsFilesIn(cwd, claudeFolder, platform).map((file) => {
    const { settings, problem } = readSettingsFile(file);
    if (problem) throw new Error(problem);
    return pick(isObject(settings) ? settings : {});
  });
  return { servers, loading: JSON.stringify([...loading, pick(project)]) };
}

/** What changed between two reads, in a few words; null when nothing that loads tools did. */
export function toolChange(before: ToolSources, now: ToolSources): string | null {
  const names = (a: ToolSources, b: ToolSources) =>
    Object.keys(a.servers).filter((name) => !(name in b.servers));
  const added = names(now, before);
  const removed = names(before, now);
  const changed = Object.keys(now.servers).filter(
    (name) => name in before.servers && before.servers[name] !== now.servers[name],
  );
  const said = [
    listed(added, 'added'),
    listed(removed, 'removed'),
    listed(changed, 'changed'),
    before.loading !== now.loading ? 'Tool settings changed' : '',
  ].filter(Boolean);
  return said.length ? said.join('; ') : null;
}

/** The files a process in `cwd` takes its tools from, by the folder each is in. */
export function toolFiles(
  cwd: string,
  claudeFolder: string = claudeHome(),
  claudeJson: string = claudeJsonPath(),
  platform: NodeJS.Platform = process.platform,
): Map<string, Set<string>> {
  const files = [
    claudeJson,
    path.join(cwd, '.mcp.json'),
    ...settingsFilesIn(cwd, claudeFolder, platform).map((file) => file.path),
  ];
  const folders = new Map<string, Set<string>>();
  for (const file of files) {
    const folder = path.dirname(path.resolve(file));
    folders.set(folder, (folders.get(folder) ?? new Set()).add(path.basename(file)));
  }
  return folders;
}

/** Starts watching a folder, calling back on each change with the name changed. */
export type Watch = (folder: string, changed: (name: string | null) => void) => { close(): void };

const watchFolder: Watch = (folder, changed) => {
  const watcher: FSWatcher = watch(folder, { persistent: false }, (_event, name) =>
    changed(name ? name.toString() : null),
  );
  watcher.on('error', () => watcher.close());
  return watcher;
};

/**
 * Watches what a chat's process in `cwd` started its tools from, and tells
 * `told` what changed since, once the files settle, or null once they're
 * back as they were; each change once.
 */
export function watchToolSources(
  cwd: string,
  told: (why: string | null) => void,
  read: () => ToolSources = () => readToolSources(cwd),
  files: Map<string, Set<string>> = toolFiles(cwd),
  watchIn: Watch = watchFolder,
): () => void {
  let started: ToolSources;
  try {
    started = read();
  } catch {
    return () => {}; // Half written as the process starts: nothing to tell changes from.
  }
  let last: string | null = null;
  let timer: NodeJS.Timeout | undefined;
  const check = () => {
    let now: ToolSources;
    try {
      now = read();
    } catch {
      return; // Half written: the write that finishes it is told too.
    }
    const why = toolChange(started, now);
    if (why === last) return;
    last = why;
    told(why);
  };
  const watchers: { close(): void }[] = [];
  for (const [folder, names] of files) {
    if (!existsSync(folder)) continue;
    try {
      watchers.push(
        watchIn(folder, (name) => {
          if (name !== null && !names.has(name)) return;
          clearTimeout(timer);
          timer = setTimeout(check, SETTLE_MS);
          timer.unref?.();
        }),
      );
    } catch {
      // A folder that can't be watched just goes unwatched.
    }
  }
  return () => {
    clearTimeout(timer);
    watchers.forEach((watcher) => watcher.close());
  };
}

/** A chat's events, told when what its process in `cwd` started its tools from changes, until the process ends. */
export function watchedForTools(cwd: string, events: ChatEvents): ChatEvents {
  const stop = watchToolSources(cwd, (why) => events.outdated(why));
  return {
    ...events,
    closed: (error) => {
      stop();
      events.closed(error);
    },
  };
}

function listed(names: string[], what: string): string {
  return names.length ? `${names.sort().join(', ')} ${what}` : '';
}

function pick(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    LOADING_KEYS.filter((key) => key in settings).map((key) => [key, settings[key]]),
  );
}

/** A project's entry in .claude.json, kept by its folder with forward slashes. */
function projectOf(
  projects: unknown,
  cwd: string,
  platform: NodeJS.Platform,
): Record<string, unknown> {
  if (!isObject(projects)) return {};
  const key = path.resolve(cwd).replace(/\\/g, '/');
  const same = (other: string) =>
    platform === 'win32' ? other.toLowerCase() === key.toLowerCase() : other === key;
  const found = Object.entries(projects).find(([folder]) => same(folder))?.[1];
  return isObject(found) ? found : {};
}

/** A JSON file's object; a missing one holds nothing, and a broken one throws. */
function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  const read: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return isObject(read) ? read : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
