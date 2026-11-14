import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeAdapter } from './fake-adapter-testing';
import { AgentHub } from './hub';
import { settings } from './hub-testing';

let fake: FakeAdapter;
let hub: AgentHub;

beforeEach(() => {
  vi.useFakeTimers();
  fake = new FakeAdapter();
  hub = new AgentHub(() => {}, 50);
  hub.addAdapter(fake);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a chat’s MCP servers', () => {
  it('say how they are while its process runs, and nothing before, without starting it', async () => {
    await hub.open('fake', 'c1', settings);
    expect(await hub.mcpStatus('c1')).toBeNull();
    expect(fake.runs).toEqual([]);

    const { id } = await hub.start('fake', settings, 'Hello');
    expect(await hub.mcpStatus(id)).toEqual([{ name: 'github', status: 'connected', tools: 2 }]);
  });

  it('connect again in the running process, and refuse while there is none', async () => {
    await hub.open('fake', 'c1', settings);
    await expect(hub.mcpReconnect('c1', 'github')).rejects.toThrow('isn’t running');

    const { id } = await hub.start('fake', settings, 'Hello');
    await hub.mcpReconnect(id, 'github');
    expect(fake.runOf(id).reconnected).toEqual(['github']);
  });
});
