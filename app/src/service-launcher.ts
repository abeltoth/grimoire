import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PROTOCOL_VERSION, SERVICE_INFO_FILE, type ServiceInfo } from '@grimoire/contract';
import { ServiceClient } from './service-client';

export interface LaunchOptions {
  /** Where the service keeps service.json and its logs. */
  dataDir: string;
  /** The bundled service script. */
  serviceEntry: string;
  /** The Node binary that runs the service: Electron itself, as Node. */
  nodePath: string;
  /** Keeps Grimoire's own data in memory, for smoke tests and captures. */
  ephemeral?: boolean;
  log: (message: string) => void;
  startTimeoutMs?: number;
}

/** A build is identified by its bundle's modification time. */
export function buildIdOf(serviceEntry: string): string {
  return String(Math.round(statSync(serviceEntry).mtimeMs));
}

/**
 * Connects to the running service, or starts one. A service from another
 * build or protocol version is asked to stop and replaced.
 */
export async function ensureService(options: LaunchOptions): Promise<ServiceClient> {
  const buildId = buildIdOf(options.serviceEntry);
  const running = await tryConnect(options.dataDir);
  if (running) {
    const { welcome } = running;
    if (welcome.buildId === buildId && welcome.protocolVersion === PROTOCOL_VERSION) return running;
    options.log(`Replacing service build ${welcome.buildId} (pid ${welcome.pid}) with build ${buildId}`);
    await stop(running);
  }
  spawnService(options, buildId);
  return waitForService(options, buildId);
}

function readInfo(dataDir: string): ServiceInfo | null {
  try {
    return JSON.parse(readFileSync(path.join(dataDir, SERVICE_INFO_FILE), 'utf8')) as ServiceInfo;
  } catch {
    return null;
  }
}

async function tryConnect(dataDir: string): Promise<ServiceClient | null> {
  const info = readInfo(dataDir);
  if (!info) return null;
  try {
    return await ServiceClient.connect(info);
  } catch {
    return null;
  }
}

async function stop(client: ServiceClient): Promise<void> {
  const closed = new Promise<void>((resolve) => client.once('close', resolve));
  client.shutdown();
  await Promise.race([closed, delay(3000)]);
  client.close();
}

function spawnService(options: LaunchOptions, buildId: string): void {
  const args = [options.serviceEntry, '--data-dir', options.dataDir, '--build-id', buildId];
  if (options.ephemeral) args.push('--ephemeral');
  const child = spawn(options.nodePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  child.unref();
}

async function waitForService(options: LaunchOptions, buildId: string): Promise<ServiceClient> {
  const deadline = Date.now() + (options.startTimeoutMs ?? 15000);
  while (Date.now() < deadline) {
    const info = readInfo(options.dataDir);
    if (info?.buildId === buildId) {
      try {
        return await ServiceClient.connect(info);
      } catch {
        // Not accepting connections yet.
      }
    }
    await delay(100);
  }
  const logFile = path.join(options.dataDir, 'logs', 'service.log');
  throw new Error(`The background service didn't start. See ${logFile}`);
}
