import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ProbeAnswers,
  type ReadSettings,
  commandFiles,
  hooksOf,
  managedSettingsPath,
  permissionsOf,
  readSettingsFile,
  settingsFilesIn,
  sourceOf,
  toSetup,
} from './setup';

const home = path.join(path.sep, 'home', 'me');
const cwd = path.join(home, 'git', 'grimoire');
const at = (...parts: string[]) => path.join(cwd, ...parts);
const mine = (...parts: string[]) => path.join(home, ...parts);

const answers: ProbeAnswers = {
  usage: {
    memoryFiles: [
      { path: mine('.claude', 'CLAUDE.md'), type: 'User', tokens: 310 },
      { path: at('CLAUDE.md'), type: 'Project', tokens: 1200 },
    ],
    mcpTools: [
      { serverName: 'claude_ai_Docs', tokens: 400 },
      { serverName: 'claude_ai_Docs', tokens: 100 },
      { serverName: 'github', tokens: 900 },
    ],
    mcpInstructions: [{ serverName: 'claude.ai Docs', tokens: 50 }],
    agents: [
      {
        agentType: 'reviewer',
        source: 'projectSettings',
        path: at('.claude', 'agents', 'reviewer.md'),
        tokens: 80,
      },
    ],
    skills: {
      skillFrontmatter: [
        {
          name: 'wrangler',
          source: 'userSettings',
          path: mine('.claude', 'skills', 'wrangler', 'SKILL.md'),
          tokens: 148,
        },
        { name: 'docs', source: 'syncedSkills', tokens: 120 },
        { name: 'dataviz', source: 'built-in', tokens: 482 },
        {
          name: 'deploy',
          source: 'plugin',
          pluginName: 'ship',
          path: '/plugins/ship/skills/deploy/SKILL.md',
          tokens: 60,
        },
      ],
    },
  },
  mcpServers: [
    { name: 'claude.ai Docs', status: 'connected', scope: 'claudeai', tools: [{}, {}] },
    { name: 'github', status: 'failed', scope: 'project', error: 'spawn gh-mcp ENOENT' },
    { name: 'linear', status: 'needs-auth', scope: 'user' },
  ],
  agents: [
    { name: 'reviewer', description: 'Reviews a diff' },
    { name: 'Explore', description: 'Fast read-only search agent' },
  ],
  commands: [
    { name: 'help', description: 'Show help', builtin: true },
    { name: 'wrangler', description: 'Cloudflare Workers CLI (user)' },
    { name: 'release', description: 'Cut a release (project)' },
    { name: 'ship:check', description: 'Check before shipping' },
    { name: '__internal', description: 'Plumbing' },
  ],
  skills: [
    { name: 'wrangler', description: 'Cloudflare Workers CLI (user)' },
    { name: 'docs', description: 'Make a doc (claude.ai sync)' },
  ],
  plugins: [
    { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
    { name: 'ship', path: '/plugins/ship', source: 'ship@acme-tools', version: '1.2.0' },
  ],
};

const user: ReadSettings = {
  source: 'user',
  path: mine('.claude', 'settings.json'),
  exists: true,
  settings: {
    permissions: { allow: ['Bash(npm test)'], deny: ['Read(.env)'], defaultMode: 'acceptEdits' },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node guard.js' }] }],
      Stop: [
        {
          hooks: [
            { type: 'command', command: 'say done' },
            { type: 'prompt', prompt: 'Check the tests ran' },
          ],
        },
      ],
    },
  },
};
const local: ReadSettings = {
  source: 'local',
  path: at('.claude', 'settings.local.json'),
  exists: true,
  settings: { permissions: { ask: ['Bash(git push:*)'], additionalDirectories: ['../shared'] } },
};
const broken: ReadSettings = {
  source: 'project',
  path: at('.claude', 'settings.json'),
  exists: true,
  problem: "Couldn't be read: Unexpected token",
};
const shipHooks: ReadSettings = {
  source: 'plugin',
  path: '/plugins/ship/hooks/hooks.json',
  exists: true,
  plugin: 'ship',
  settings: {
    hooks: {
      PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'prettier' }] }],
    },
  },
};

const setup = () =>
  toSetup({
    cwd,
    home,
    answers,
    settings: [user, broken, local],
    pluginHooks: [shipHooks],
    commandFiles: new Map([['release', at('.claude', 'commands', 'release.md')]]),
    at: 42,
  });

describe('toSetup', () => {
  it('lists the memory files, named from the folder or your home folder', () => {
    expect(setup().sections.memory).toEqual([
      {
        name: `~${path.sep}${path.join('.claude', 'CLAUDE.md')}`,
        detail: 'Your instructions, in every folder',
        source: 'user',
        path: mine('.claude', 'CLAUDE.md'),
        tokens: 310,
      },
      {
        name: 'CLAUDE.md',
        detail: 'The project’s instructions',
        source: 'project',
        path: at('CLAUDE.md'),
        tokens: 1200,
      },
    ]);
  });

  it('names the memory files from your home folder when it works there', () => {
    const there = toSetup({
      cwd: home,
      home,
      answers,
      settings: [],
      pluginHooks: [],
      commandFiles: new Map(),
      at: 1,
    });
    expect(there.sections.memory.map((file) => file.name)).toEqual([
      `~${path.sep}${path.join('.claude', 'CLAUDE.md')}`,
      `~${path.sep}${path.join('git', 'grimoire', 'CLAUDE.md')}`,
    ]);
  });

  it('lists the skills with where each comes from, what it does and its cost', () => {
    expect(setup().sections.skills).toEqual([
      {
        name: 'wrangler',
        detail: 'Cloudflare Workers CLI',
        source: 'user',
        path: mine('.claude', 'skills', 'wrangler', 'SKILL.md'),
        tokens: 148,
      },
      { name: 'docs', detail: 'Make a doc', source: 'account', tokens: 120 },
      { name: 'dataviz', source: 'built-in', tokens: 482 },
      {
        name: 'deploy',
        source: 'plugin',
        plugin: 'ship',
        path: '/plugins/ship/skills/deploy/SKILL.md',
        tokens: 60,
      },
    ]);
  });

  it('lists your subagents first, then the built-in ones', () => {
    expect(setup().sections.agents).toEqual([
      {
        name: 'reviewer',
        detail: 'Reviews a diff',
        source: 'project',
        path: at('.claude', 'agents', 'reviewer.md'),
        tokens: 80,
      },
      { name: 'Explore', detail: 'Fast read-only search agent', source: 'built-in' },
    ]);
  });

  it('lists only the commands that are neither built in nor skills', () => {
    expect(setup().sections.commands).toEqual([
      {
        name: 'release',
        detail: 'Cut a release',
        source: 'project',
        path: at('.claude', 'commands', 'release.md'),
      },
      { name: 'ship:check', detail: 'Check before shipping', source: 'plugin' },
    ]);
  });

  it('lists the MCP servers with their state, tools and cost, and what went wrong', () => {
    expect(setup().sections.mcpServers).toEqual([
      { name: 'claude.ai Docs', detail: 'Connected · 2 tools', source: 'account', tokens: 550 },
      {
        name: 'github',
        detail: 'Failed to connect',
        source: 'project',
        path: at('.mcp.json'),
        tokens: 900,
        problem: 'spawn gh-mcp ENOENT',
      },
      { name: 'linear', detail: 'Needs signing in', source: 'user', problem: 'Needs signing in' },
    ]);
  });

  it('lists the plugins, saying which come with Claude Code', () => {
    expect(setup().sections.plugins).toEqual([
      { name: 'cc-plugin-telemetry', detail: 'Comes with Claude Code', source: 'built-in' },
      { name: 'ship', detail: 'Version 1.2.0 · From acme-tools', source: 'plugin' },
    ]);
  });

  it('lists the hooks of every settings file and plugin, by event and matcher', () => {
    expect(setup().sections.hooks).toEqual([
      { name: 'PreToolUse · Bash', detail: 'node guard.js', source: 'user', path: user.path },
      { name: 'Stop', detail: 'say done', source: 'user', path: user.path },
      { name: 'Stop', detail: 'Check the tests ran', source: 'user', path: user.path },
      {
        name: 'PostToolUse · Write|Edit',
        detail: 'prettier',
        source: 'plugin',
        plugin: 'ship',
        path: shipHooks.path,
      },
    ]);
  });

  it('lists the permission rules, denials first, and says which settings file could not be read', () => {
    const { sections, settingsFiles, at: when } = setup();
    expect(sections.permissions).toEqual([
      { name: 'Read(.env)', detail: 'Denied', source: 'user', path: user.path },
      { name: 'Bash(npm test)', detail: 'Allowed without asking', source: 'user', path: user.path },
      { name: 'Default mode', detail: 'acceptEdits', source: 'user', path: user.path },
      { name: 'Bash(git push:*)', detail: 'Asks first', source: 'local', path: local.path },
      {
        name: '../shared',
        detail: 'An extra folder it can work in',
        source: 'local',
        path: local.path,
      },
    ]);
    expect(settingsFiles).toEqual([
      { source: 'user', path: user.path, exists: true },
      {
        source: 'project',
        path: broken.path,
        exists: true,
        problem: "Couldn't be read: Unexpected token",
      },
      { source: 'local', path: local.path, exists: true },
    ]);
    expect(when).toBe(42);
  });
});

describe('sourceOf', () => {
  it('reads the sources Claude Code names', () => {
    expect(sourceOf('userSettings')).toBe('user');
    expect(sourceOf('projectSettings')).toBe('project');
    expect(sourceOf('localSettings')).toBe('local');
    expect(sourceOf('policySettings')).toBe('managed');
    expect(sourceOf('plugin')).toBe('plugin');
    expect(sourceOf('syncedSkills')).toBe('account');
    expect(sourceOf('claude.ai sync')).toBe('account');
    expect(sourceOf('built-in')).toBe('built-in');
    expect(sourceOf(undefined)).toBe('built-in');
  });
});

describe('hooksOf and permissionsOf', () => {
  it('ignore settings without hooks or permissions, or of the wrong shape', () => {
    const odd: ReadSettings = {
      ...user,
      settings: { hooks: { Stop: 'say done' }, permissions: { allow: 'all' } },
    };
    expect(hooksOf(odd)).toEqual([]);
    expect(permissionsOf(odd)).toEqual([]);
    expect(hooksOf(broken)).toEqual([]);
  });
});

describe('settingsFilesIn', () => {
  it('lists your settings, the project’s, your own for the project, then the managed ones', () => {
    expect(settingsFilesIn(cwd, home, 'linux')).toEqual([
      { source: 'user', path: mine('.claude', 'settings.json') },
      { source: 'project', path: at('.claude', 'settings.json') },
      { source: 'local', path: at('.claude', 'settings.local.json') },
      { source: 'managed', path: '/etc/claude-code/managed-settings.json' },
    ]);
  });

  it('lists your settings once in your home folder', () => {
    expect(settingsFilesIn(home, home, 'darwin').map((file) => file.source)).toEqual([
      'user',
      'local',
      'managed',
    ]);
  });

  it('knows where each system keeps the managed settings', () => {
    expect(managedSettingsPath('win32')).toBe(
      'C:\\Program Files\\ClaudeCode\\managed-settings.json',
    );
    expect(managedSettingsPath('darwin')).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    );
  });
});

describe('files', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads a settings file, and says why one could not be read', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'grimoire-setup-'));
    const good = path.join(dir, 'good.json');
    const bad = path.join(dir, 'bad.json');
    writeFileSync(good, '{"permissions":{"allow":["Read"]}}');
    writeFileSync(bad, '{ nope');
    expect(readSettingsFile({ source: 'user', path: good })).toEqual({
      source: 'user',
      path: good,
      exists: true,
      settings: { permissions: { allow: ['Read'] } },
    });
    expect(readSettingsFile({ source: 'user', path: bad }).problem).toMatch(/^Couldn't be read: /);
    expect(readSettingsFile({ source: 'local', path: path.join(dir, 'none.json') })).toEqual({
      source: 'local',
      path: path.join(dir, 'none.json'),
      exists: false,
    });
  });

  it('finds your commands, a subfolder joined with ":", the first folder winning', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'grimoire-commands-'));
    const project = path.join(dir, 'project');
    const yours = path.join(dir, 'yours');
    mkdirSync(path.join(project, 'frontend'), { recursive: true });
    mkdirSync(yours, { recursive: true });
    writeFileSync(path.join(project, 'release.md'), '');
    writeFileSync(path.join(project, 'frontend', 'component.md'), '');
    writeFileSync(path.join(yours, 'release.md'), '');
    writeFileSync(path.join(yours, 'idea.md'), '');
    writeFileSync(path.join(yours, 'notes.txt'), '');
    const found = commandFiles([project, yours, path.join(dir, 'missing')]);
    expect(Object.fromEntries(found)).toEqual({
      release: path.join(project, 'release.md'),
      'frontend:component': path.join(project, 'frontend', 'component.md'),
      idea: path.join(yours, 'idea.md'),
    });
  });
});
