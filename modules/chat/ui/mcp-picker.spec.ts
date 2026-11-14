import type { AgentSetup, CommandRequest, SetupItem } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { fakeBridge, pick, render, write } from '@ui/testing/app-testing';

const empty = {
  memory: [],
  skills: [],
  agents: [],
  commands: [],
  hooks: [],
  mcpServers: [],
  plugins: [],
  permissions: [],
};

async function withServers(servers: SetupItem[], offEverywhere: string[] = []) {
  const fake = fakeBridge();
  fake.answers['setup.get'] = (request: CommandRequest<'setup.get'>): AgentSetup => ({
    cwd: request.cwd ?? 'C:/Users/me',
    sections: { ...empty, mcpServers: servers },
    settingsFiles: [],
    at: new Date(2026, 10, 9, 15, 30).getTime(),
  });
  fake.answers['settings.get'] = () => ({ ...DEFAULT_SETTINGS, mcpOff: offEverywhere });
  const rendered = await render(fake.bridge);
  await write(rendered.fixture, rendered.el, 'Hello');
  rendered.el.querySelector<HTMLButtonElement>('.meta [data-setting="mode"]')!.click();
  await rendered.fixture.whenStable();
  return { ...fake, ...rendered };
}

const configured = (calls: { command: string; request: unknown }[]) =>
  calls.filter((c) => c.command === 'agents.configure').map((c) => c.request);

describe('mcp-picker', () => {
  it('sums the servers up in a line, and turns one off for one chat, not for the next', async () => {
    const { fixture, el, texts, calls, emit } = await withServers(
      [
        { name: 'github', source: 'project', tokens: 4200 },
        { name: 'slack', source: 'user', tokens: 900 },
        { name: 'claude.ai Gmail', source: 'account', tokens: 1000 },
      ],
      ['slack'],
    );
    expect(texts('gr-mcp-picker .count')).toEqual(['2 of 3 on · 5,200 tokens']);
    expect(el.querySelector('gr-mcp-picker .server')).toBeNull();

    pick(el, 'Choose…');
    await fixture.whenStable();
    // Grouped by where they come from; one off in every chat stays off here.
    expect(texts('gr-mcp-picker h4')).toEqual(['Yours', 'Project', 'Claude account']);
    expect(texts('gr-mcp-picker .server .name')).toEqual(['slack', 'github', 'claude.ai Gmail']);
    expect(texts('gr-mcp-picker .server small')).toEqual([
      'off in every chapter',
      '4,200 tokens',
      '1,000 tokens',
    ]);
    expect(texts('gr-mcp-picker .server[aria-disabled] .name')).toEqual(['slack']);
    expect(texts('gr-mcp-picker .none')).toEqual(['A change counts from its next turn']);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Find an MCP server');

    pick(el, 'github');
    pick(el, 'slack');
    await fixture.whenStable();
    expect(configured(calls)).toEqual([{ chatId: 'chat-1', change: { mcpOff: ['github'] } }]);
    emit('agents.settings', {
      chatId: 'chat-1',
      settings: { cwd: 'C:/work/grimoire', mcpOff: ['github'] },
    });
    await fixture.whenStable();
    expect(texts('gr-mcp-picker .count')).toEqual(['1 of 3 on · 1,000 tokens']);
    // A new chat takes the settings used last, but not the servers turned off for this one.
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toEqual({
      lastUsed: { agent: 'claude-code', settings: { cwd: 'C:/work/grimoire' } },
    });
  });

  it('finds servers by name, and turns the ones found off or on at once', async () => {
    const { fixture, el, texts, calls } = await withServers([
      { name: 'claude.ai Slack', source: 'account', tokens: 32000 },
      { name: 'claude.ai Gmail', source: 'account' },
      { name: 'playwright', source: 'plugin', plugin: 'ai-workflow' },
    ]);
    pick(el, 'Choose…');
    await fixture.whenStable();
    const filter = el.querySelector<HTMLInputElement>('gr-mcp-picker .filter')!;
    filter.value = 'CLAUDE.AI';
    filter.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-mcp-picker .server .name')).toEqual(['claude.ai Gmail', 'claude.ai Slack']);

    pick(el, 'These off');
    expect(configured(calls).at(-1)).toEqual({
      chatId: 'chat-1',
      change: { mcpOff: ['claude.ai Slack', 'claude.ai Gmail'] },
    });

    filter.value = 'nothing';
    filter.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-mcp-picker .none')[0]).toBe('No server called that');

    // Esc shuts the list and leaves the card open.
    filter.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(el.querySelector('gr-mcp-picker .list')).toBeNull();
    expect(el.querySelector('gr-settings-card')).not.toBeNull();

    pick(el, 'Choose…');
    await fixture.whenStable();
    pick(el, 'All on');
    expect(configured(calls).at(-1)).toEqual({ chatId: 'chat-1', change: { mcpOff: [] } });
  });
});
