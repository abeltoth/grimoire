import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Entry } from '@grimoire/contract';
import { ServiceEvents } from '@grimoire/service/core/events';
import { type ModuleContext, Modules } from '@grimoire/service/core/module';
import { CommandRegistry } from '@grimoire/service/core/registry';
import { openDatabase } from '@grimoire/service/testing/database';
import { autoLabels } from '.';

/** The module started with Settings asking for titles, beside stand-ins for the hub and the History. */
function started() {
  const registry = new CommandRegistry();
  const events = new ServiceEvents();
  const renamed: unknown[] = [];
  registry.register('history.pinsAndTags', () => ({ pins: {}, tags: {}, summaries: {} }));
  registry.register('history.tagList', () => []);
  const entries: Entry[] = [{ kind: 'user', id: 'u1', text: 'Add a context meter' }];
  const hub = {
    agents: () => [{ id: 'fake', name: 'Fake', capabilities: ['ask'] }],
    listChats: async () => [{ id: 'old', agent: 'fake', title: 'Old', updatedAt: 1 }],
    glance: (chatId: string) =>
      chatId === 'c1'
        ? { agent: 'fake', title: '', cwd: '/work', status: 'idle', capabilities: ['ask'] }
        : undefined,
    transcript: async () => entries,
    ask: async (_agent: string, instructions: string) =>
      instructions.includes('suggest') ? '["Meter"]' : '{"title": "Context meter"}',
    rename: async (chatId: string, title: string, by: string) =>
      void renamed.push({ chatId, title, by }),
  };
  const hooks = new Modules([autoLabels]);
  hooks.start({
    registry,
    db: openDatabase(':memory:'),
    events,
    hub,
    settings: { get: () => ({ ...DEFAULT_SETTINGS, autoTitles: true }) },
    log: () => {},
  } as unknown as ModuleContext);
  return { registry, events, renamed, hooks };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('auto-labels', () => {
  it('names a chat once its first turn ends, through the agent', async () => {
    const { events, renamed } = started();
    events.emit('agents.turnEnded', { chatId: 'c1' });
    // A turn that failed, or a chat that's gone, isn't labelled.
    events.emit('agents.turnEnded', { chatId: 'c1', error: 'stopped' });
    events.emit('agents.turnEnded', { chatId: 'gone' });
    await tick();
    expect(renamed).toEqual([{ chatId: 'c1', title: 'Context meter', by: 'grimoire' }]);
  });

  it('never renames a chat you named, even before it was first labelled', async () => {
    const { events, renamed } = started();
    events.emit('agents.title', { chatId: 'c1', title: 'My own name', by: 'you' });
    // Titles the agent or Grimoire gave don't count as yours.
    events.emit('agents.title', { chatId: 'old', title: 'Agent name', by: 'agent' });
    events.emit('agents.turnEnded', { chatId: 'c1' });
    await tick();
    expect(renamed).toEqual([]);
  });

  it('suggests tags from the titles of the agents’ chats', async () => {
    const { registry } = started();
    expect(await registry.call('labels.suggestTags', {})).toEqual(['meter']);
  });
});
