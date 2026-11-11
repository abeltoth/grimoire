import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../registry';
import { registerPing } from './ping';

afterEach(() => {
  vi.useRealTimers();
});

describe('core.ping', () => {
  it('answers with the build, and how long the service has run', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(65_000);
    const registry = new CommandRegistry();
    registerPing(registry, { buildId: 'b1', startedAt: 5_000 });
    expect(await registry.call('core.ping', {} as never)).toEqual({
      pid: process.pid,
      buildId: 'b1',
      startedAt: 5_000,
      uptimeMs: 60_000,
      node: process.versions.node,
    });
  });
});
