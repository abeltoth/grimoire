import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { claudeHome } from '@grimoire/service/agents/claude/config-dir';
import { probe } from '@grimoire/service/agents/claude/probe';
import {
  type ReadSettings,
  readSettingsFile,
  settingsFilesIn,
} from '@grimoire/service/agents/claude/settings-files';
import type {
  AgentSetup,
  SettingsFile,
  SetupItem,
  SetupSection,
  SetupSource,
} from '@grimoire/contract';
import type { SetupReader } from './setup';

/**
 * What a Claude Code process that never gets a message tells of its setup,
 * in the shapes the SDK answers with; only the parts read here.
 */
export interface ProbeAnswers {
  usage: {
    memoryFiles: { path: string; type: string; tokens: number }[];
    mcpTools: { serverName: string; tokens: number }[];
    mcpInstructions?: { serverName: string; tokens: number }[];
    agents: {
      agentType: string;
      source: string;
      pluginId?: string;
      path?: string;
      tokens: number;
    }[];
    skills?: {
      skillFrontmatter: {
        name: string;
        source: string;
        pluginName?: string;
        path?: string;
        tokens: number;
      }[];
    };
  };
  mcpServers: {
    name: string;
    status: string;
    scope?: string;
    source?: string;
    error?: string;
    tools?: unknown[];
  }[];
  agents: { name: string; description: string }[];
  commands: { name: string; description: string; builtin?: boolean }[];
  skills: { name: string; description: string }[];
  plugins: { name: string; path: string; source?: string; version?: string }[];
}

/**
 * Your own commands, by the name Claude Code gives them: a file's path in
 * a commands folder, without ".md", a subfolder's name joined with ":".
 */
export function commandFiles(folders: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (folder: string, prefix: string) => {
    let names: string[];
    try {
      names = readdirSync(folder);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(folder, name);
      if (name.endsWith('.md')) {
        const command = `${prefix}${name.slice(0, -3)}`;
        if (!found.has(command)) found.set(command, full);
      } else if (!name.includes('.')) {
        walk(full, `${prefix}${name}:`);
      }
    }
  };
  folders.forEach((folder) => walk(folder, ''));
  return found;
}

/** Where Claude Code says something comes from, such as "userSettings", "syncedSkills" or "built-in". */
export function sourceOf(said: string | undefined): SetupSource {
  const s = (said ?? '').toLowerCase();
  if (s.includes('plugin')) return 'plugin';
  if (s.includes('policy') || s.includes('managed') || s.includes('enterprise')) return 'managed';
  if (s.includes('local')) return 'local';
  if (s.includes('project')) return 'project';
  if (s.includes('user')) return 'user';
  if (s.includes('synced') || s.includes('claude.ai') || s.includes('claudeai')) return 'account';
  return 'built-in';
}

/** A command's description without the "(user)" or "(claude.ai sync)" Claude Code ends it with, and that source. */
function splitDescription(description: string): { text: string; source?: SetupSource } {
  const end = /\s*\(([^()]+)\)$/.exec(description);
  if (!end) return { text: description };
  return { text: description.slice(0, end.index).trim(), source: sourceOf(end[1]) };
}

const MEMORY: Record<string, string> = {
  User: 'Your instructions, in every folder',
  Project: 'The project’s instructions',
  Local: 'Your instructions for this project',
  Managed: 'Your organization’s instructions',
  AutoMem: 'What Claude remembers on its own',
};

const MCP_STATUS: Record<string, string> = {
  connected: 'Connected',
  pending: 'Still connecting',
  disabled: 'Turned off',
  failed: 'Failed to connect',
  'needs-auth': 'Needs signing in',
};

const VERDICTS = [
  ['deny', 'Denied'],
  ['ask', 'Asks first'],
  ['allow', 'Allowed without asking'],
] as const;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** A name the way Claude Code writes an MCP server's into its tools' names. */
const normal = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '_');

/** A path from the folder when it's inside it, else from your home folder as "~/…". */
function shortPath(file: string, cwd: string, home: string): string {
  const inside = (folder: string) => {
    const relative = path.relative(folder, file);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      ? relative
      : undefined;
  };
  const fromCwd = path.resolve(cwd) === path.resolve(home) ? undefined : inside(cwd);
  if (fromCwd) return fromCwd;
  const fromHome = inside(home);
  return fromHome ? `~${path.sep}${fromHome}` : file;
}

/** A settings file's hooks, one item a hook, named by its event and what it matches. */
export function hooksOf(file: ReadSettings): SetupItem[] {
  const hooks = record(record(file.settings)?.['hooks']);
  if (!hooks) return [];
  return Object.entries(hooks).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : []).flatMap((group) => {
      const matcher = record(group)?.['matcher'];
      return (
        Array.isArray(record(group)?.['hooks']) ? (record(group)!['hooks'] as unknown[]) : []
      ).map((hook): SetupItem => {
        const own = record(hook) ?? {};
        const does = [own['command'], own['prompt'], own['url'], own['type']].find(
          (value): value is string => typeof value === 'string' && value !== '',
        );
        return {
          name: typeof matcher === 'string' && matcher ? `${event} · ${matcher}` : event,
          ...(does ? { detail: does } : {}),
          source: file.source,
          ...(file.plugin ? { plugin: file.plugin } : {}),
          path: file.path,
        };
      });
    }),
  );
}

/** A settings file's permission rules, denials first, then its default mode and extra folders. */
export function permissionsOf(file: ReadSettings): SetupItem[] {
  const permissions = record(record(file.settings)?.['permissions']);
  if (!permissions) return [];
  const at = { source: file.source, path: file.path };
  const items: SetupItem[] = VERDICTS.flatMap(([key, verdict]) =>
    strings(permissions[key]).map((rule) => ({ name: rule, detail: verdict, ...at })),
  );
  const mode = permissions['defaultMode'];
  if (typeof mode === 'string') items.push({ name: 'Default mode', detail: mode, ...at });
  for (const folder of strings(permissions['additionalDirectories'])) {
    items.push({ name: folder, detail: 'An extra folder it can work in', ...at });
  }
  return items;
}

/** Everything Claude Code loads in a folder, by section, from what it told and what its settings files hold. */
export function toSetup(input: {
  cwd: string;
  home: string;
  answers: ProbeAnswers;
  settings: readonly ReadSettings[];
  /** The plugins' hooks files. */
  pluginHooks: readonly ReadSettings[];
  commandFiles: ReadonlyMap<string, string>;
  at: number;
}): AgentSetup {
  const { cwd, home, answers, settings } = input;
  const { usage } = answers;

  const memory = usage.memoryFiles.map((file): SetupItem => ({
    name: shortPath(file.path, cwd, home),
    ...(MEMORY[file.type] ? { detail: MEMORY[file.type] } : { detail: file.type }),
    source: sourceOf(file.type === 'AutoMem' ? 'user' : file.type),
    path: file.path,
    tokens: file.tokens,
  }));

  const skillText = new Map(
    answers.skills.map((skill) => [skill.name, splitDescription(skill.description).text]),
  );
  const skillList = usage.skills?.skillFrontmatter ?? [];
  const skills = skillList.map((skill): SetupItem => ({
    name: skill.name,
    ...(skillText.get(skill.name) ? { detail: skillText.get(skill.name)! } : {}),
    source: sourceOf(skill.source),
    ...(skill.pluginName ? { plugin: skill.pluginName } : {}),
    ...(skill.path ? { path: skill.path } : {}),
    tokens: skill.tokens,
  }));

  const agentText = new Map(answers.agents.map((agent) => [agent.name, agent.description]));
  const custom = new Set(usage.agents.map((agent) => agent.agentType));
  const agents: SetupItem[] = [
    ...usage.agents.map((agent): SetupItem => ({
      name: agent.agentType,
      ...(agentText.get(agent.agentType) ? { detail: agentText.get(agent.agentType)! } : {}),
      source: sourceOf(agent.source),
      ...(agent.pluginId ? { plugin: agent.pluginId } : {}),
      ...(agent.path ? { path: agent.path } : {}),
      tokens: agent.tokens,
    })),
    ...answers.agents
      .filter((agent) => !custom.has(agent.name))
      .map((agent): SetupItem => ({
        name: agent.name,
        detail: agent.description,
        source: 'built-in',
      })),
  ];

  const skillNames = new Set([
    ...skillList.map((skill) => skill.name),
    ...answers.skills.map((s) => s.name),
  ]);
  const commands = answers.commands
    .filter(
      (command) =>
        !command.builtin && !skillNames.has(command.name) && !command.name.startsWith('__'),
    )
    .map((command): SetupItem => {
      const { text, source } = splitDescription(command.description);
      const file = input.commandFiles.get(command.name);
      return {
        name: command.name,
        ...(text ? { detail: text } : {}),
        source: source ?? (command.name.includes(':') ? 'plugin' : 'user'),
        ...(file ? { path: file } : {}),
      };
    });

  const toolTokens = new Map<string, number>();
  for (const tool of usage.mcpTools) {
    toolTokens.set(tool.serverName, (toolTokens.get(tool.serverName) ?? 0) + tool.tokens);
  }
  const mcpServers = answers.mcpServers.map((server): SetupItem => {
    const tokens =
      (toolTokens.get(normal(server.name)) ?? toolTokens.get(server.name) ?? 0) +
      (usage.mcpInstructions?.find((own) => own.serverName === server.name)?.tokens ?? 0);
    const said = MCP_STATUS[server.status] ?? server.status;
    const tools = server.tools?.length;
    const scope = server.scope ?? server.source;
    return {
      name: server.name,
      detail:
        server.status === 'connected' && tools !== undefined
          ? `${said} · ${tools} ${tools === 1 ? 'tool' : 'tools'}`
          : said,
      source: scope === 'sdk' || scope === 'dynamic' ? 'built-in' : sourceOf(scope),
      ...(scope === 'project' ? { path: path.join(cwd, '.mcp.json') } : {}),
      ...(tokens ? { tokens } : {}),
      ...(server.status === 'failed'
        ? { problem: server.error || said }
        : server.status === 'needs-auth'
          ? { problem: said }
          : {}),
    };
  });

  const plugins = answers.plugins.map((plugin): SetupItem => {
    const builtIn = plugin.path === 'builtin';
    const from = builtIn ? 'Comes with Claude Code' : plugin.source?.split('@')[1];
    const detail = [
      plugin.version ? `Version ${plugin.version}` : '',
      from ? (builtIn ? from : `From ${from}`) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      name: plugin.name,
      ...(detail ? { detail } : {}),
      source: builtIn ? 'built-in' : 'plugin',
    };
  });

  const read = [...settings, ...input.pluginHooks];
  const sections: Record<SetupSection, SetupItem[]> = {
    memory,
    skills,
    agents,
    commands,
    hooks: read.flatMap(hooksOf),
    mcpServers,
    plugins,
    permissions: settings.flatMap(permissionsOf),
  };
  return {
    cwd,
    sections,
    settingsFiles: settings.map(({ source, path: file, exists, problem }) => ({
      source,
      path: file,
      exists,
      ...(problem ? { problem } : {}),
    })),
    at: input.at,
  };
}

/** How long to wait for MCP servers to connect before listing what they bring. */
const MCP_SETTLE_MS = 5_000;

/**
 * What Claude Code loads in a folder: its memory, skills, subagents,
 * commands, hooks, MCP servers, plugins and permissions. A process in the
 * folder that never gets a message is asked, a moment given for its MCP
 * servers to connect, and the hooks and permission rules are read from the
 * settings files it reads.
 */
export const claudeSetup: SetupReader = {
  read: (cwd) =>
    probe(async (claude) => {
      const since = Date.now();
      let mcpServers = await claude.mcpServerStatus();
      while (mcpServers.some((server) => server.status === 'pending') && Date.now() - since < MCP_SETTLE_MS) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        mcpServers = await claude.mcpServerStatus();
      }
      const usage = await claude.getContextUsage({ detail: 'full' });
      const agents = await claude.supportedAgents();
      const commands = await claude.supportedCommands();
      const { skills } = await claude.reloadSkills();
      const { plugins } = await claude.reloadPlugins();
      const home = homedir();
      const claudeFolder = claudeHome();
      const settings = settingsFilesIn(cwd, claudeFolder, process.platform).map((file) =>
        readSettingsFile(file),
      );
      const pluginHooks = plugins
        .filter((plugin) => plugin.path !== 'builtin')
        .map((plugin) =>
          readSettingsFile(
            { source: 'plugin', path: path.join(plugin.path, 'hooks', 'hooks.json') },
            plugin.name,
          ),
        )
        .filter((file) => file.exists);
      return toSetup({
        cwd,
        home,
        answers: { usage, mcpServers, agents, commands, skills, plugins },
        settings,
        pluginHooks,
        commandFiles: commandFiles([
          path.join(cwd, '.claude', 'commands'),
          path.join(claudeFolder, 'commands'),
        ]),
        at: Date.now(),
      });
    }, cwd),
};
