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
import { PROTOCOL_VERSION, SERVICE_INFO_FILE, type ServiceInfo } from '@grimoire/contract';
import { ClaudeAdapter } from './agents/claude/claude-adapter';
import { registerAgentCommands } from './agents/commands';
import { AgentHub, hubStore } from './agents/hub';
import { LayoutStore, registerLayout } from './core/layout';
import { PresetStore, registerPresets } from './core/presets';
import { registerPing } from './core/ping';
import { endpointFor } from './endpoint';
import { registerGit } from './git/commands';
import { Git } from './git/git';
import { Worktrees } from './git/worktrees';
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
registerLayout(registry, new LayoutStore(db));
registerPresets(registry, new PresetStore(db));
registerGit(registry, new Git());

// The search worker, bundled beside the service, keeps its index beside Grimoire's data.
const search = new SearchWorker(
  () =>
    forkWorker(
      fileURLToPath(new URL('./search-worker.mjs', import.meta.url)),
      values.ephemeral ? ':memory:' : path.join(dataDir, 'search.db'),
    ),
  log,
);
registerSearch(registry, search);

const hub = new AgentHub(
  (event, payload) => {
    server?.broadcast(event, payload);
    // A turn or a new title changes what a search finds.
    if (event === 'agents.turnEnded' || event === 'agents.title') search.markStale();
  },
  50,
  hubStore(db),
  new Worktrees(new WorktreeRecords(db), log),
  log,
);
const claude = new ClaudeAdapter();
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

const token = randomBytes(32).toString('hex');
const endpoint = endpointFor(dataDir);

async function stop(): Promise<void> {
  hub.closeAll();
  terminals.closeAll();
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
