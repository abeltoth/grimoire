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
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PROTOCOL_VERSION, SERVICE_INFO_FILE, type ServiceInfo } from '@grimoire/contract';
import { ClaudeAdapter } from './agents/claude/claude-adapter';
import { useClaudeFolder } from './agents/claude/config-dir';
import { ClaudeRestarts } from './agents/claude/restarts';
import { registerAgentCommands } from './agents/commands';
import { AgentHub } from './agents/hub';
import { hubStore } from './agents/chat-table';
import { AgentTools } from './agents/tools';
import { LayoutStore, registerLayout } from './core/layout';
import { PresetStore, registerPresets } from './core/presets';
import { ProfileStore, registerProfiles } from './core/profiles';
import { SettingsStore, registerSettings } from './core/settings';
import { registerPing } from './core/ping';
import { endpointFor } from './endpoint';
import { ServiceEvents } from './events';
import { Modules } from './module';
import { MODULES } from './modules';
import { CommandRegistry } from './registry';
import { AlreadyRunningError, startServer, type ServiceServer } from './server';
import { removeServiceInfo, writeServiceInfo } from './service-info';
import { openDatabase } from './storage/database';

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
const log = (message: string) =>
  appendFileSync(logFile, `${new Date().toISOString()} [${process.pid}] ${message}\n`);
const infoFile = path.join(dataDir, SERVICE_INFO_FILE);

process.on('uncaughtException', (error) => {
  log(`Uncaught: ${error.stack ?? String(error)}`);
  process.exit(1);
});

const registry = new CommandRegistry();
registerPing(registry, { buildId, startedAt: Date.now() });

let server: ServiceServer | undefined;
const events = new ServiceEvents();
const broadcast = events.emit;
const modules = new Modules(MODULES);

const db = openDatabase(values.ephemeral ? ':memory:' : path.join(dataDir, 'grimoire.db'));
// Each profile but Personal has a Claude folder of its own beside Grimoire's data.
const profiles = new ProfileStore(
  db,
  (id) => path.join(dataDir, 'profiles', id, 'claude'),
  (id) => modules.profileRemoved(id),
);
// Claude Code uses the profile's folder from the start, before anything reads it or starts it.
useClaudeFolder(profiles.active().claudeFolder);
registerLayout(registry, new LayoutStore(db));
const settingsStore = new SettingsStore(db);
registerPresets(registry, new PresetStore(db), settingsStore, broadcast);
registerSettings(registry, settingsStore, broadcast);

const hub = new AgentHub(broadcast, 50, hubStore(db));
const tools = new AgentTools();
const claude = new ClaudeAdapter(
  () => settingsStore.get().mcpOff,
  () => settingsStore.get().suggestions,
  () => settingsStore.get().followUps,
  () => tools.all(),
);
hub.addAdapter(claude);
const restarts = new ClaudeRestarts(claude, hub, () => settingsStore.get());
events.on('settings.changed', ({ settings }) => restarts.settingsChanged(settings));
claude.warm();
registerAgentCommands(registry, hub);

registerProfiles(
  registry,
  profiles,
  {
    busy: () => hub.busy(),
    putAway: () => hub.putAway(),
    reset: () => claude.reset(),
    useClaudeFolder,
    restart: () => restarts.profileSwitched(),
    announce: () => {
      broadcast('settings.changed', { settings: settingsStore.get() });
      void hub.announceAccounts();
      modules.profileSwitched();
    },
  },
  broadcast,
);

modules.start({
  registry,
  db,
  events,
  log,
  dataDir,
  ephemeral: values.ephemeral,
  settings: settingsStore,
  profiles,
  hub,
  registerTool: (tool) => tools.register(tool),
});

const token = randomBytes(32).toString('hex');
const endpoint = endpointFor(dataDir);

async function stop(): Promise<void> {
  hub.closeAll();
  modules.stop();
  await server?.close();
  db.close();
  removeServiceInfo(infoFile, process.pid);
  log('Stopped');
  process.exit(0);
}

try {
  server = await startServer({
    endpoint,
    token,
    buildId,
    registry,
    log,
    onShutdown: () => void stop(),
  });
} catch (error) {
  if (error instanceof AlreadyRunningError) {
    log(error.message);
    process.exit(0);
  }
  throw error;
}

events.toWindows(server.broadcast);

const info: ServiceInfo = {
  endpoint,
  token,
  pid: process.pid,
  buildId,
  protocolVersion: PROTOCOL_VERSION,
};
writeServiceInfo(infoFile, info);
log(`Listening on ${endpoint}, build ${buildId}`);
modules.ready();

process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
