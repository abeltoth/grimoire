/**
 * The background service (ADR-010). The Electron app starts it detached on
 * Electron's own Node (ELECTRON_RUN_AS_NODE), and it keeps running when the
 * app quits.
 *
 *   node service.mjs --data-dir <dir> --build-id <id>
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PROTOCOL_VERSION, SERVICE_INFO_FILE, type ServiceInfo } from '@grimoire/contract';
import { ClaudeAdapter } from './agents/claude/claude-adapter';
import { registerAgentCommands } from './agents/commands';
import { AgentHub } from './agents/hub';
import { registerPing } from './core/ping';
import { endpointFor } from './endpoint';
import { CommandRegistry } from './registry';
import { AlreadyRunningError, startServer, type ServiceServer } from './server';

const { values } = parseArgs({
  options: {
    'data-dir': { type: 'string' },
    'build-id': { type: 'string', default: 'unknown' },
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

const hub = new AgentHub((event, payload) => server?.broadcast(event, payload));
hub.addAdapter(new ClaudeAdapter());
registerAgentCommands(registry, hub);

const token = randomBytes(32).toString('hex');
const endpoint = endpointFor(dataDir);

async function stop(): Promise<void> {
  hub.closeAll();
  await server?.close();
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
