/**
 * The background service (ADR-010). The Electron app starts it detached on
 * Electron's own Node (ELECTRON_RUN_AS_NODE), and it keeps running when the
 * app quits.
 *
 *   node service.mjs --data-dir <dir> --build-id <id> [--ephemeral]
 *
 * --ephemeral keeps Grimoire's own data in memory, for smoke tests and captures.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  type EventPayload,
  PERSONAL_PROFILE,
  PROTOCOL_VERSION,
  SERVICE_INFO_FILE,
  type ServiceInfo,
} from '@grimoire/contract';
import { ClaudeAdapter } from './agents/claude/claude-adapter';
import { useClaudeFolder } from './agents/claude/config-dir';
import { openConnectors } from './agents/claude/connectors';
import { registerAgentCommands } from './agents/commands';
import { AgentHub, hubStore } from './agents/hub';
import { LayoutStore, registerLayout } from './core/layout';
import { PresetStore, registerPresets } from './core/presets';
import { ProfileStore, registerProfiles } from './core/profiles';
import { SettingsStore, registerSettings } from './core/settings';
import { registerPing } from './core/ping';
import { endpointFor } from './endpoint';
import { registerGit } from './git/commands';
import { Git } from './git/git';
import { registerFiles } from './files/commands';
import { Files } from './files/files';
import { Worktrees } from './git/worktrees';
import { registerJira, registerKanban } from './kanban/commands';
import { JiraMoves } from './kanban/jira-moves';
import { JiraSyncer } from './kanban/jira-sync';
import { CardStore } from './kanban/store';
import { CommandRegistry } from './registry';
import { AlreadyRunningError, startServer, type ServiceServer } from './server';
import { registerSchedules } from './schedules/commands';
import { Scheduler } from './schedules/scheduler';
import { ScheduleStore } from './schedules/store';
import { registerSearch } from './search/commands';
import { SearchWorker, forkWorker } from './search/search-worker';
import { openDatabase } from './storage/database';
import { WorktreeRecords } from './storage/worktrees';
import { registerTerminals } from './terminal/commands';
import { Terminals } from './terminal/terminals';

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    'build-id': { type: 'string', default: 'unknown' },
    ephemeral: { type: 'boolean', default: false },
  },
});

const dataDir = values['data-dir'];
if (!dataDir) {
  console.error('Missing --data-dir');
  process.exit(2);
}
const buildId = values['build-id'];

mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
const logFile = path.join(dataDir, 'logs', 'service.log');
const log = (message: string) => appendFileSync(logFile, `${new Date().toISOString()} [${process.pid}] ${message}\n`);
const infoFile = path.join(dataDir, SERVICE_INFO_FILE);

process.on('uncaughtException', (error) => {
  log(`Uncaught: ${error.stack ?? String(error)}`);
  process.exit(1);
});

const registry = new CommandRegistry();
registerPing(registry, { buildId, startedAt: Date.now() });

let server: ServiceServer | undefined;

const db = openDatabase(values.ephemeral ? ':memory:' : path.join(dataDir, 'grimoire.db'));
// Each profile but Personal has a Claude folder of its own beside Grimoire's data.
const profiles = new ProfileStore(db, (id) => path.join(dataDir, 'profiles', id, 'claude'));
// Claude Code uses the profile's folder from the start, before anything reads it or starts it.
useClaudeFolder(profiles.active().claudeFolder);
registerLayout(registry, new LayoutStore(db));
const settingsStore = new SettingsStore(db);
const broadcast: Parameters<typeof registerSettings>[2] = (event, payload) =>
  server?.broadcast(event, payload);
registerPresets(registry, new PresetStore(db), settingsStore, broadcast);
let { mcpOff, suggestions, followUps } = settingsStore.get();
registerSettings(registry, settingsStore, (event, payload) => {
  broadcast(event, payload);
  if (event !== 'settings.changed') return;
  const settings = (payload as EventPayload<'settings.changed'>).settings;
  // Suggestions, or separate tasks, turned on or off: the spare starts again with them; open chats, when theirs next does.
  if (settings.suggestions !== suggestions || settings.followUps !== followUps) {
    ({ suggestions, followUps } = settings);
    claude.dispose();
    claude.warm();
  }
  // Other MCP servers off in every chat: the open chats, and the spare, start again with them.
  const now = settings.mcpOff;
  if (now.length === mcpOff.length && now.every((name) => mcpOff.includes(name))) return;
  mcpOff = now;
  hub.mcpChanged();
  claude.dispose();
  claude.warm();
});
const git = new Git();
registerGit(registry, git);
const files = new Files(git, (event, payload) => server?.broadcast(event, payload));
registerFiles(registry, files);

// The search worker, bundled beside the service, keeps an index per profile beside Grimoire's data.
const searchIndex = (profile: string) =>
  path.join(dataDir, profile === PERSONAL_PROFILE ? 'search.db' : `search-${profile}.db`);
const search = new SearchWorker(
  () =>
    forkWorker(
      fileURLToPath(new URL('./search-worker.mjs', import.meta.url)),
      values.ephemeral ? ':memory:' : searchIndex(profiles.active().id),
    ),
  log,
);
registerSearch(registry, search);

const worktrees = new Worktrees(new WorktreeRecords(db), log);
const hub = new AgentHub(
  (event, payload) => {
    server?.broadcast(event, payload);
    // A turn or a new title changes what a search finds.
    if (event === 'agents.turnEnded' || event === 'agents.title') search.markStale();
  },
  50,
  hubStore(db),
  worktrees,
  log,
);
const cards = new CardStore(db);
const claude = new ClaudeAdapter(
  () => settingsStore.get().mcpOff,
  () => settingsStore.get().suggestions,
  () => settingsStore.get().followUps,
  // A task the agent adds goes on the board in use, which every window is told of. One
  // added in a chat's own worktree is in the folder that was made from: the worktree goes.
  (draft, madeIn) => {
    const cwd = worktrees.origin(draft.cwd) ?? draft.cwd;
    broadcast('kanban.changed', { cards: cards.save({ ...draft, cwd }, madeIn) });
  },
);
hub.addAdapter(claude);
claude.warm();
registerAgentCommands(registry, hub);
// The plan's limits are read every quarter of an hour, for the Ledger's history.
hub.readUsageEvery(15 * 60_000);

const terminals = new Terminals((event, payload) => server?.broadcast(event, payload));
registerTerminals(registry, terminals);

const scheduler = new Scheduler(
  new ScheduleStore(db),
  (agent, settings, text, title) => hub.start(agent, settings, text, title),
  (event, payload) => server?.broadcast(event, payload),
);
registerSchedules(registry, scheduler);

registerKanban(registry, cards, broadcast);
// Your Jira issues come through your claude.ai Atlassian connector, on a Claude Code process of their own;
// moving one in Jira, on another, the one that may change Jira.
const jira = new JiraSyncer(cards, () => settingsStore.get().jiraQuery, openConnectors, broadcast, log);
const jiraMoves = new JiraMoves(cards, openConnectors, broadcast, log);
registerJira(registry, jira, jiraMoves);

registerProfiles(
  registry,
  profiles,
  {
    busy: () => hub.busy(),
    putAway: () => hub.putAway(),
    reset: () => claude.reset(),
    useClaudeFolder,
    restart: () => {
      // The spare starts with the new profile's MCP servers off, suggestions and separate tasks; its settings don't restart it.
      ({ mcpOff, suggestions, followUps } = settingsStore.get());
      search.restart();
      claude.warm();
    },
    announce: () => {
      broadcast('settings.changed', { settings: settingsStore.get() });
      broadcast('schedules.changed', { schedules: scheduler.list() });
      broadcast('kanban.changed', { cards: cards.list() });
      broadcast('kanban.jira', { jira: jira.state() });
      void hub.announceAccounts();
    },
  },
  broadcast,
);

const token = randomBytes(32).toString('hex');
const endpoint = endpointFor(dataDir);

async function stop(): Promise<void> {
  hub.closeAll();
  jiraMoves.close();
  terminals.closeAll();
  files.dispose();
  search.close();
  await server?.close();
  db.close();
  removeInfoFileIfOurs();
  log('Stopped');
  process.exit(0);
}

try {
  server = await startServer({ endpoint, token, buildId, registry, log, onShutdown: () => void stop() });
} catch (error) {
  if (error instanceof AlreadyRunningError) {
    log(error.message);
    process.exit(0);
  }
  throw error;
}

const info: ServiceInfo = { endpoint, token, pid: process.pid, buildId, protocolVersion: PROTOCOL_VERSION };
writeFileSync(`${infoFile}.tmp`, JSON.stringify(info), { mode: 0o600 });
renameSync(`${infoFile}.tmp`, infoFile);
log(`Listening on ${endpoint}, build ${buildId}`);
// Checked twice a minute, which also notices a time that passed while the computer slept.
scheduler.checkEvery(30_000);
// The board's Jira issues are synced every hour, as well as when the board opens.
jira.syncEvery(60 * 60_000);
search.warm();

process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());

function removeInfoFileIfOurs(): void {
  try {
    const current = JSON.parse(readFileSync(infoFile, 'utf8')) as ServiceInfo;
    if (current.pid === process.pid) rmSync(infoFile, { force: true });
  } catch {
    // Already gone, or replaced by another service.
  }
}
