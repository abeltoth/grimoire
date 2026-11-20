import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ToolSources,
  type Watch,
  readToolSources,
  toolChange,
  toolFiles,
  watchToolSources,
} from './tool-sources';

let root: string;
let claudeFolder: string;
let claudeJson: string;
let cwd: string;

const write = (file: string, value: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
};
const read = () => readToolSources(cwd, claudeFolder, claudeJson, 'linux');

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'grimoire-tools-'));
  claudeFolder = path.join(root, '.claude');
  claudeJson = path.join(root, '.claude.json');
  cwd = path.join(root, 'work');
  mkdirSync(cwd);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readToolSources', () => {
  it('reads your MCP servers, the project’s and your own for the project', () => {
    write(claudeJson, {
      numStartups: 4,
      mcpServers: { jira: { url: 'https://jira' } },
      projects: {
        [path.resolve(cwd).replace(/\\/g, '/')]: { mcpServers: { db: { command: 'db' } } },
      },
    });
    write(path.join(cwd, '.mcp.json'), { mcpServers: { docs: { command: 'docs' } } });

    expect(Object.keys(read().servers).sort()).toEqual(['db', 'docs', 'jira']);
  });

  it('reads which plugins load from the settings files', () => {
    const before = read();
    write(path.join(claudeFolder, 'settings.json'), { enabledPlugins: { 'git@market': true } });

    expect(read().loading).not.toBe(before.loading);
  });

  it('reads whether Claude in Chrome is on, but not the rest of .claude.json', () => {
    write(claudeJson, { numStartups: 4 });
    const before = read();
    write(claudeJson, { numStartups: 5 });
    expect(read()).toEqual(before);
    write(claudeJson, { numStartups: 5, claudeInChromeDefaultEnabled: true });
    expect(read().chrome).toBe(true);
  });

  it('throws while a file is half written', () => {
    write(claudeJson, '{"mcpServers": {');
    expect(read).toThrow();
  });
});

describe('toolChange', () => {
  const sources = (
    servers: Record<string, string>,
    loading = '[]',
    chrome = false,
  ): ToolSources => ({ servers, loading, chrome });

  it('names the servers added, removed and changed', () => {
    expect(toolChange(sources({ a: '1', b: '1' }), sources({ a: '2', c: '1', d: '1' }))).toBe(
      'c, d added; b removed; a changed',
    );
  });

  it('says when plugins or MCP settings changed', () => {
    expect(toolChange(sources({}), sources({}, '[{}]'))).toBe('Tool settings changed');
  });

  it('says when Claude in Chrome was turned on or off', () => {
    expect(toolChange(sources({}), sources({}, '[]', true))).toBe('Claude in Chrome turned on');
    expect(toolChange(sources({}, '[]', true), sources({}))).toBe('Claude in Chrome turned off');
  });

  it('is null when nothing that loads tools changed', () => {
    expect(toolChange(sources({ a: '1' }), sources({ a: '1' }))).toBeNull();
  });
});

describe('toolFiles', () => {
  it('watches each file by its folder', () => {
    const files = toolFiles(cwd, claudeFolder, claudeJson, 'linux');
    expect(files.get(path.resolve(root))).toEqual(new Set(['.claude.json']));
    expect(files.get(path.resolve(cwd))).toEqual(new Set(['.mcp.json']));
    expect(files.get(path.resolve(cwd, '.claude'))).toEqual(
      new Set(['settings.json', 'settings.local.json']),
    );
  });
});

describe('watchToolSources', () => {
  let current: ToolSources;
  let changed: ((name: string | null) => void) | undefined;
  let told: (string | null)[];
  const watchIn: Watch = (_folder, callback) => {
    changed = callback;
    return { close: () => (changed = undefined) };
  };
  const start = () =>
    watchToolSources(
      cwd,
      (why) => told.push(why),
      () => current,
      new Map([[cwd, new Set(['.mcp.json'])]]),
      watchIn,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    current = { servers: {}, loading: '[]', chrome: false };
    told = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tells what changed once the files settle, and once they’re back as they were', () => {
    start();
    current = { servers: { jira: '{}' }, loading: '[]', chrome: false };
    changed!('.mcp.json');
    changed!('.mcp.json');
    vi.advanceTimersByTime(500);
    expect(told).toEqual(['jira added']);

    changed!('.mcp.json');
    vi.advanceTimersByTime(500);
    expect(told).toHaveLength(1);

    current = { servers: {}, loading: '[]', chrome: false };
    changed!('.mcp.json');
    vi.advanceTimersByTime(500);
    expect(told).toEqual(['jira added', null]);
  });

  it('ignores other files in the folders watched', () => {
    start();
    current = { servers: { jira: '{}' }, loading: '[]', chrome: false };
    changed!('notes.md');
    vi.advanceTimersByTime(500);
    expect(told).toEqual([]);
  });

  it('stops watching when stopped', () => {
    const stop = start();
    stop();
    expect(changed).toBeUndefined();
  });
});
