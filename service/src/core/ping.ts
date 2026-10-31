import type { CommandRegistry } from '../registry';

export function registerPing(registry: CommandRegistry, info: { buildId: string; startedAt: number }): void {
  registry.register('core.ping', () => ({
    pid: process.pid,
    buildId: info.buildId,
    startedAt: info.startedAt,
    uptimeMs: Date.now() - info.startedAt,
    node: process.versions.node,
  }));
}
