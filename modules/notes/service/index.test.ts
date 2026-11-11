import type { EventName, EventPayload, Note } from '@grimoire/contract';
import { describe, expect, it } from 'vitest';
import type { AgentTool, ModuleContext } from '@grimoire/service/core/module';
import { CommandRegistry } from '@grimoire/service/core/registry';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { notes } from '.';
import { MIGRATIONS } from './migrations';

function started() {
  const db = openDatabase(':memory:');
  migrate(db, 'notes', MIGRATIONS);
  const registry = new CommandRegistry();
  const tools: AgentTool[] = [];
  const told: [EventName, EventPayload<EventName>][] = [];
  const hooks = notes.start({
    registry,
    db,
    events: {
      emit: (event: EventName, payload: EventPayload<EventName>) => told.push([event, payload]),
    },
    registerTool: (tool: AgentTool) => tools.push(tool),
  } as unknown as ModuleContext);
  return { registry, tools, told, hooks: hooks! };
}

describe('the notes module', () => {
  it('tells every window of each change, but not of a listing', async () => {
    const { registry, told } = started();
    const [note] = (await registry.dispatch('notes.save', { text: 'A', pinned: false })) as Note[];
    await registry.dispatch('notes.done', { id: note!.id, done: true });
    const left = await registry.dispatch('notes.remove', { id: note!.id });
    await registry.dispatch('notes.list', {});
    expect(told.map(([event]) => event)).toEqual(Array(3).fill('notes.changed'));
    expect(told.at(-1)![1]).toEqual({ notes: left });
  });

  it('gives the agent add_note, whose notes every window is told of', async () => {
    const { tools, told } = started();
    expect(tools.map((tool) => tool.name)).toEqual(['add_note']);
    const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' };
    await tools[0]!.run({ text: 'Check the PR' }, chat);
    expect((told[0]![1] as EventPayload<'notes.changed'>).notes).toMatchObject([
      { text: 'Check the PR', madeIn: chat },
    ]);
  });

  it('tells of the notes again when the profile changes', () => {
    const { told, hooks } = started();
    hooks.profileSwitched!();
    expect(told).toEqual([['notes.changed', { notes: [] }]]);
  });
});
