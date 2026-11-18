import type { EventName, EventPayload } from '@grimoire/contract';
import { describe, expect, it } from 'vitest';
import type { AgentTool, ModuleContext } from '@grimoire/service/core/module';
import { CommandRegistry } from '@grimoire/service/core/registry';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { kanban } from '.';
import { MIGRATIONS } from './migrations';

const chat = { chatId: 'chat-1', agent: 'claude-code', cwd: '/git/grimoire' };

/** The module started on a new board, with Jira on as `settings` says. */
function started(
  settings: { jira: boolean; jiraProject?: string; jiraIssueType?: string } = { jira: true },
) {
  const db = openDatabase(':memory:');
  migrate(db, 'kanban', MIGRATIONS);
  const registry = new CommandRegistry();
  const tools: AgentTool[] = [];
  const told: [EventName, EventPayload<EventName>][] = [];
  kanban.start({
    registry,
    db,
    events: {
      emit: (event: EventName, payload: EventPayload<EventName>) => told.push([event, payload]),
    },
    settings: {
      get: () => ({ jiraQuery: '', jiraProject: '', jiraIssueType: 'Task', ...settings }),
    },
    log: () => {},
    registerTool: (tool: AgentTool) => tools.push(tool),
  } as unknown as ModuleContext);
  const tool = (name: string) => tools.find((known) => known.name === name)!;
  return { db, registry, tools, told, tool };
}

describe('the kanban module', () => {
  it('gives the agent add_todo, whose cards go on the board every window is told of', async () => {
    const { tools, told, tool } = started();
    expect(tools.map((known) => known.name)).toEqual(['add_todo', 'propose_jira_issue']);
    await tool('add_todo').run({ title: 'Context meter' }, chat);
    expect(told).toHaveLength(1);
    const [event, payload] = told[0]!;
    expect(event).toBe('kanban.changed');
    expect((payload as EventPayload<'kanban.changed'>).cards).toMatchObject([
      { title: 'Context meter', cwd: '/git/grimoire', madeIn: chat },
    ]);
  });

  it('gives propose_jira_issue while Jira is on', () => {
    const settings = { jira: true };
    const { tool } = started(settings);
    const proposing = tool('propose_jira_issue');
    expect(proposing.enabled?.()).toBe(true);
    settings.jira = false;
    expect(proposing.enabled?.()).toBe(false);
  });

  it('keeps what the agent proposes, for every window to list until it is dismissed', async () => {
    const { registry, tool, told } = started({
      jira: true,
      jiraProject: 'GRIM',
      jiraIssueType: 'Story',
    });
    await tool('propose_jira_issue').run({ summary: 'Context meter', description: '' }, chat);
    const draft = {
      summary: 'Context meter',
      description: '',
      project: 'GRIM',
      issueType: 'Story',
    };
    expect(await registry.call('kanban.proposals', {})).toEqual({ 'chat-1': draft });
    await registry.call('kanban.dismissProposal', { chatId: 'chat-1' });
    expect(await registry.call('kanban.proposals', {})).toEqual({});
    expect(told.map(([event]) => event)).toEqual(['kanban.proposed', 'kanban.proposed']);
  });
});
