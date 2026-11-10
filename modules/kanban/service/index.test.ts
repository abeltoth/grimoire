import type { EventName, EventPayload } from '@grimoire/contract';
import { describe, expect, it } from 'vitest';
import type { AgentTool, ModuleContext } from '@grimoire/service/core/module';
import { CommandRegistry } from '@grimoire/service/core/registry';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { kanban } from '.';
import { MIGRATIONS } from './migrations';

describe('the kanban module', () => {
  it('gives the agent add_todo, whose cards go on the board every window is told of', async () => {
    const db = openDatabase(':memory:');
    migrate(db, 'kanban', MIGRATIONS);
    const tools: AgentTool[] = [];
    const told: [EventName, EventPayload<EventName>][] = [];
    kanban.start({
      registry: new CommandRegistry(),
      db,
      events: {
        emit: (event: EventName, payload: EventPayload<EventName>) => told.push([event, payload]),
      },
      settings: { get: () => ({ jiraQuery: '' }) },
      log: () => {},
      registerTool: (tool: AgentTool) => tools.push(tool),
    } as unknown as ModuleContext);

    expect(tools.map((tool) => tool.name)).toEqual(['add_todo']);
    const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' };
    await tools[0]!.run({ title: 'Context meter' }, chat);
    expect(told).toHaveLength(1);
    const [event, payload] = told[0]!;
    expect(event).toBe('kanban.changed');
    expect((payload as EventPayload<'kanban.changed'>).cards).toMatchObject([
      { title: 'Context meter', cwd: '/git/grimoire', madeIn: chat },
    ]);
  });
});
