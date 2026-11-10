import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { ServiceInfo } from '@grimoire/contract';

/**
 * Tells the app where the running service listens, in service.json: written
 * whole and readable only by you, so the app never reads half of it and
 * nobody else reads its token.
 */
export function writeServiceInfo(file: string, info: ServiceInfo): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(info), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/** Removes service.json as the service stops, unless another service has replaced it since. */
export function removeServiceInfo(file: string, pid: number): void {
  try {
    const current = JSON.parse(readFileSync(file, 'utf8')) as ServiceInfo;
    if (current.pid === pid) rmSync(file, { force: true });
  } catch {
    // Already gone, or replaced by another service.
  }
}
