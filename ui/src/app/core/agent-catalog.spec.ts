import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ChatSummary } from '@grimoire/contract';
import { fakeBridge } from '../../testing/app-harness';
import { AgentCatalog } from './agent-catalog';
import { GRIMOIRE_BRIDGE } from './bridge';

async function catalog(setup: (fake: ReturnType<typeof fakeBridge>) => void = () => {}) {
  const fake = fakeBridge();
  setup(fake);
  TestBed.configureTestingModule({
    providers: [{ provide: GRIMOIRE_BRIDGE, useValue: fake.bridge }],
  });
  const agents = TestBed.inject(AgentCatalog);
  await TestBed.inject(ApplicationRef).whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  return agents;
}

describe('AgentCatalog', () => {
  it('names each agent, and what it can do, as the service lists them', async () => {
    const agents = await catalog(({ answers }) => {
      answers['agents.list'] = () => [
        { id: 'claude-code', name: 'Claude Code', capabilities: ['rename'] },
      ];
    });
    expect(agents.agentName('claude-code')).toBe('Claude Code');
    expect(agents.agentName('other')).toBe('other');
    expect(agents.can('claude-code', 'rename')).toBe(true);
    expect(agents.can('other', 'rename')).toBe(false);
  });

  it("names a chat's model, the default when it names none, and Auto's pick once begun", async () => {
    const agents = await catalog();
    expect(agents.modelName('claude-code', 'sonnet')).toBe('Sonnet 5.5');
    expect(agents.modelName('claude-code', undefined)).toBe('Opus 5.5');
    expect(agents.modelName('claude-code', 'unknown')).toBe('unknown');
    const auto = { autoModel: true, model: 'haiku' };
    expect(agents.modelLabel('claude-code', auto, false)).toBe('Auto');
    expect(agents.modelLabel('claude-code', auto, true)).toBe('Auto: Haiku 5.5');
  });

  it("gives the efforts a chat's model takes, and the one it runs at", async () => {
    const agents = await catalog();
    expect(agents.effortOf('claude-code', {})).toEqual({
      levels: ['low', 'medium', 'high', 'xhigh', 'max'],
      level: 'xhigh',
    });
    expect(agents.effortOf('claude-code', { model: 'sonnet', effort: 'xhigh' }).level).toBe('high');
    expect(agents.effortOf('claude-code', { model: 'haiku' })).toEqual({ levels: [] });
  });

  it('writes a folder in your home folder with ~', async () => {
    const agents = await catalog();
    expect(agents.folderName('C:/Users/me/git/grimoire')).toBe('~/git/grimoire');
    expect(agents.folderName('C:/Users/me')).toBe('~');
    expect(agents.folderName('C:/Users/meg')).toBe('C:/Users/meg');
    expect(agents.folderName(undefined)).toBe('~');
  });

  it("lists every agent's chats, most recent first", async () => {
    const summary = (id: string, updatedAt: number) =>
      ({ id, agent: 'claude-code', title: id, updatedAt }) as ChatSummary;
    const agents = await catalog(({ answers }) => {
      answers['agents.chats'] = () => [summary('old', 1), summary('new', 2)];
    });
    expect((await agents.pastChats()).map((chat) => chat.id)).toEqual(['new', 'old']);
  });
});
