import { mkdtempSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServiceClient } from './service-client';
import { ensureService } from './service-launcher';

// Runs the real service, bundled into a temp folder, on this test's Node.
const tmp = mkdtempSync(path.join(os.tmpdir(), 'grimoire-launcher-'));
const serviceEntry = path.join(tmp, 'service.mjs');
const dataDir = path.join(tmp, 'data');
const options = { dataDir, serviceEntry, nodePath: process.execPath, log: () => {} };
const clients: ServiceClient[] = [];

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilGone(pid: number): Promise<boolean> {
  for (let i = 0; i < 50 && isRunning(pid); i++) await new Promise((r) => setTimeout(r, 100));
  return !isRunning(pid);
}

beforeAll(async () => {
  await esbuild.build({
    entryPoints: [path.resolve(__dirname, '../../service/src/main.ts')],
    outfile: serviceEntry,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
});

afterAll(async () => {
  const last = clients.at(-1);
  if (last && !last.isClosed) {
    const pid = last.welcome.pid;
    last.shutdown();
    await waitUntilGone(pid);
  }
  clients.forEach((client) => client.close());
});

describe('ensureService', () => {
  it('starts a service, reuses it, and replaces it after a rebuild', { timeout: 30_000 }, async () => {
    const first = await ensureService(options);
    clients.push(first);
    expect(await first.request('core.ping', {})).toMatchObject({ pid: first.welcome.pid });

    // The app quits: the service keeps running and the next launch reuses it.
    first.close();
    const second = await ensureService(options);
    clients.push(second);
    expect(second.welcome.pid).toBe(first.welcome.pid);

    // A rebuild changes the build ID: the old service stops and a new one starts.
    const later = new Date(Date.now() + 5_000);
    utimesSync(serviceEntry, later, later);
    const third = await ensureService(options);
    clients.push(third);
    expect(third.welcome.pid).not.toBe(first.welcome.pid);
    expect(await waitUntilGone(first.welcome.pid)).toBe(true);
  });
});
