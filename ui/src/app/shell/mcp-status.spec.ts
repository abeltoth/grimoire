import { fakeBridge, render, write } from '../../testing/app-testing';

/** Each server's row: its name, what it says, and its buttons. */
const rows = (el: HTMLElement) =>
  [...el.querySelectorAll('gr-mcp-status .server')].map((row) =>
    [...row.querySelectorAll('.name, .status, button')].map((part) => part.textContent!.trim()),
  );

describe('McpStatus', () => {
  it('says how the chat’s MCP servers are, connects one again, and turns one off', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    answers['agents.list'] = () => [
      { id: 'claude-code', name: 'Claude Code', capabilities: ['mcp'] },
    ];
    answers['agents.commands'] = () => [];
    answers['agents.mcpStatus'] = () => [
      { name: 'linear', status: 'failed', error: 'Connection closed', tools: 0 },
      { name: 'github', status: 'connected', tools: 2 },
    ];
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();

    expect(texts('gr-mcp-status h3')).toEqual(['MCP servers']);
    expect(rows(el)).toEqual([
      ['github', 'connected · 2 tools', 'Reconnect', 'Turn off'],
      ['linear', 'failed: Connection closed', 'Reconnect', 'Turn off'],
    ]);

    const field = el.querySelector<HTMLInputElement>('#gr-command-palette-search')!;
    field.value = 'lin';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-mcp-status .name')).toEqual(['linear']);
    field.value = 'mc';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-mcp-status .name')).toEqual(['github', 'linear']);

    const button = (row: number, label: string) =>
      [...el.querySelectorAll('gr-mcp-status .server')[row]!.querySelectorAll('button')].find(
        (b) => b.textContent!.trim() === label,
      )!;
    button(1, 'Reconnect').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.mcpReconnect').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', name: 'linear' },
    ]);
    expect(calls.filter((c) => c.command === 'agents.mcpStatus')).toHaveLength(2);

    button(1, 'Turn off').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.configure').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', change: { mcpOff: ['linear'] } },
    ]);
    emit('agents.settings', {
      chatId: 'chat-1',
      settings: { cwd: 'C:/work/grimoire', mcpOff: ['linear'] },
    });
    await fixture.whenStable();
    expect(rows(el)[1]).toEqual(['linear', 'off from the next start', 'Turn on']);
  });

  it('lists a blank chat’s servers from its setup, without asking for a process it has not got', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.list'] = () => [
      { id: 'claude-code', name: 'Claude Code', capabilities: ['mcp'] },
    ];
    answers['agents.commands'] = () => [];
    answers['setup.get'] = () => ({
      sections: { mcpServers: [{ name: 'github', source: 'user' }] },
    });
    const { fixture, el } = await render(bridge);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(rows(el)).toEqual([['github', 'starts with the chapter', 'Turn off']]);
    expect(calls.filter((c) => c.command === 'agents.mcpStatus')).toEqual([]);
  });

  it('isn’t there for an agent that can’t say how its servers are', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.commands'] = () => [];
    const { fixture, el } = await render(bridge);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-command-palette')).not.toBeNull();
    expect(el.querySelector('gr-mcp-status')).toBeNull();
  });
});
