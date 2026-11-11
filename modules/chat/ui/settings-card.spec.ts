import type { AgentSetup, CommandRequest, OpenChat, Preset } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { fakeBridge, pick, render, write } from '@ui/testing/app-testing';

describe('settings-card', () => {
  it("changes a blank chat's settings on its settings card", async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    const model = el.querySelector<HTMLButtonElement>('.meta [data-setting="model"]')!;
    model.click();
    await fixture.whenStable();

    expect(model.getAttribute('aria-expanded')).toBe('true');
    expect(texts('gr-settings-card .column.on h3')).toEqual(['Model for Claude Code']);
    expect(texts('gr-settings-card [aria-checked="true"]')).toEqual([
      'Claude Code',
      'Opus 5.5',
      'Extra high',
      '~',
      'Ask first Asks before edits and commands',
      'No preset',
    ]);
    expect(texts('gr-settings-card [data-setting="folder"] code')).toEqual([
      '~',
      '~/git/grimoire',
      '~/git/breeder',
    ]);
    expect(document.activeElement?.textContent?.trim()).toBe('Opus 5.5');

    pick(el, 'Sonnet 5.5');
    await fixture.whenStable();
    // Sonnet takes no Extra high, and your settings give it no effort.
    expect(texts('gr-settings-card [data-setting="effort"] h3')).toEqual(['Effort for Sonnet 5.5']);
    expect(texts('gr-settings-card [data-setting="effort"] .choice')).toEqual([
      'Low',
      'Medium',
      'High',
      'Max',
    ]);
    expect(texts('.meta button')[2]).toBe('Default effort');
    pick(el, 'Max');
    pick(el, 'Full access');
    pick(el, 'Choose another folder');
    await fixture.whenStable();
    expect(texts('.meta button')).toEqual([
      'Claude Code',
      'Sonnet 5.5',
      'Max effort',
      'Full access',
      '~/git/new',
      'No preset',
    ]);
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toEqual({
      lastUsed: {
        agent: 'claude-code',
        settings: { model: 'sonnet', effort: 'max', mode: 'allow-all', cwd: 'C:/Users/me/git/new' },
      },
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(el.querySelector('gr-settings-card')).toBeNull();
    expect(document.activeElement).toBe(model);

    await write(fixture, el, 'Hello');
    expect(calls.find((c) => c.command === 'agents.start')?.request).toMatchObject({
      settings: { model: 'sonnet', mode: 'allow-all', cwd: 'C:/Users/me/git/new' },
    });
  });

  it('begins a chat on Auto, then shows the model Auto picked', async () => {
    const { bridge, calls, answers } = fakeBridge();
    answers['agents.start'] = (request: CommandRequest<'agents.start'>): OpenChat => ({
      id: 'chat-1',
      agent: request.agent,
      title: '',
      settings: { ...request.settings, cwd: 'C:/work/grimoire', model: 'sonnet', effort: 'medium' },
      status: 'thinking',
      entries: [{ kind: 'user', id: 'u1', text: request.text }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
    });
    const { fixture, el, texts } = await render(bridge);
    const model = () => el.querySelector<HTMLButtonElement>('.meta [data-setting="model"]')!;
    model().click();
    await fixture.whenStable();
    expect(texts('gr-settings-card [data-setting="model"] .choice')).toEqual([
      'Auto',
      'Opus 5.5',
      'Sonnet 5.5',
      'Haiku 5.5',
    ]);

    pick(el, 'Auto');
    await fixture.whenStable();
    expect(texts('gr-settings-card [data-setting="model"] [aria-checked="true"]')).toEqual([
      'Auto',
    ]);
    expect(texts('gr-settings-card [data-setting="effort"] .none')).toEqual([
      'Auto picks the effort too',
    ]);
    // Auto picks the effort with the model, so the head shows no effort yet.
    expect(texts('.meta button')).toEqual(['Claude Code', 'Auto', 'Ask first', '~', 'No preset']);
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toMatchObject({
      lastUsed: { agent: 'claude-code', settings: { autoModel: true } },
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    await write(fixture, el, 'Rename the ribbon');
    const started = calls.find((c) => c.command === 'agents.start')!
      .request as CommandRequest<'agents.start'>;
    expect(started.settings).toMatchObject({ autoModel: true });
    expect(started.settings.model).toBeUndefined();
    expect(texts('.meta button').slice(1, 3)).toEqual(['Auto: Sonnet 5.5', 'Medium effort']);

    // Once begun, Auto can't be picked again; another model ends it.
    model().click();
    await fixture.whenStable();
    expect(texts('gr-settings-card [data-setting="model"] .choice')).toEqual([
      'Opus 5.5',
      'Sonnet 5.5',
      'Haiku 5.5',
    ]);
    expect(texts('gr-settings-card [data-setting="model"] .none')).toEqual([
      'Auto picked Sonnet 5.5 for your first entry',
    ]);
    pick(el, 'Opus 5.5');
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.configure')?.request).toEqual({
      chatId: 'chat-1',
      change: { model: 'opus' },
    });
  });

  it('changes only the model and permission once the chat has begun', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    el.querySelector<HTMLButtonElement>('.meta [data-setting="mode"]')!.click();
    await fixture.whenStable();

    expect(texts('gr-settings-card .card-head span')).toEqual([
      'Its agent and folder stay as it began. Pick to change the rest.',
    ]);
    expect(texts('gr-settings-card [data-setting="folder"] .choice[aria-disabled]')).toEqual([
      '~/git/grimoire',
      '~',
    ]);
    expect(texts('gr-settings-card .action')).toEqual(['Save these settings as a preset…']);

    pick(el, 'Plan only');
    pick(el, 'Medium');
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.configure').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', change: { mode: 'plan' } },
      { chatId: 'chat-1', change: { effort: 'medium' } },
    ]);
    emit('agents.settings', {
      chatId: 'chat-1',
      settings: { cwd: 'C:/work/grimoire', mode: 'plan', effort: 'medium' },
    });
    await fixture.whenStable();
    expect(texts('.meta button').slice(2, 4)).toEqual(['Medium effort', 'Plan only']);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-settings-card')).toBeNull();
  });

  it('turns MCP servers off for one chat on its settings card, and not for the next', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
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
    answers['setup.get'] = (request: CommandRequest<'setup.get'>): AgentSetup => ({
      cwd: request.cwd ?? 'C:/Users/me',
      sections: {
        ...empty,
        mcpServers: [
          { name: 'github', source: 'project', tokens: 4200 },
          { name: 'slack', source: 'user', tokens: 900 },
        ],
      },
      settingsFiles: [],
      at: new Date(2026, 10, 9, 15, 30).getTime(),
    });
    answers['settings.get'] = () => ({ ...DEFAULT_SETTINGS, mcpOff: ['slack'] });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Hello');
    el.querySelector<HTMLButtonElement>('.meta [data-setting="mode"]')!.click();
    await fixture.whenStable();

    const column = 'gr-settings-card [data-setting="mcp"]';
    // What each costs; one off in every chat stays off here.
    expect(texts(`${column} .choice`)).toEqual([
      'github 4,200 tokens',
      'slack off in every chapter',
    ]);
    expect(texts(`${column} .choice[aria-checked="true"]`)).toEqual(['github 4,200 tokens']);
    expect(texts(`${column} .choice[aria-disabled]`)).toEqual(['slack off in every chapter']);
    expect(texts(`${column} .none`)).toEqual(['A change counts from its next turn']);

    pick(el, 'github');
    pick(el, 'slack');
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.configure').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', change: { mcpOff: ['github'] } },
    ]);
    emit('agents.settings', {
      chatId: 'chat-1',
      settings: { cwd: 'C:/work/grimoire', mcpOff: ['github'] },
    });
    await fixture.whenStable();
    expect(texts(`${column} .choice[aria-checked="true"]`)).toEqual([]);
    // A new chat takes the settings used last, but not the servers turned off for this one.
    expect(calls.filter((c) => c.command === 'layout.set').at(-1)?.request).toEqual({
      lastUsed: { agent: 'claude-code', settings: { cwd: 'C:/work/grimoire' } },
    });
  });

  it("saves a chat's settings as a preset, and puts chats on it", async () => {
    const { bridge, calls, answers } = fakeBridge();
    let saved: Preset[] = [];
    answers['presets.list'] = () => saved;
    answers['presets.save'] = (preset: Preset) => (saved = [...saved, preset]);
    const { fixture, el, texts } = await render(bridge);
    const head = () => texts('.meta button');
    const open = async (setting: string) => {
      el.querySelector<HTMLButtonElement>(`.meta [data-setting="${setting}"]`)!.click();
      await fixture.whenStable();
    };
    const presetColumn = '.column[data-setting="preset"]';

    await open('preset');
    expect(texts(`${presetColumn} .none`)).toEqual(['No saved presets yet']);
    expect(texts(`${presetColumn} [aria-checked="true"]`)).toEqual(['No preset']);
    el.querySelector<HTMLButtonElement>(`${presetColumn} .action`)!.click();
    await fixture.whenStable();
    const name = el.querySelector<HTMLInputElement>('.preset-name')!;
    expect(document.activeElement).toBe(name);
    name.value = 'Plan a feature';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();

    // The defaults are written in, so the preset means the same later.
    expect(calls.find((c) => c.command === 'presets.save')!.request).toEqual({
      name: 'Plan a feature',
      agent: 'claude-code',
      settings: { cwd: 'C:/Users/me', model: 'opus', effort: 'xhigh', mode: 'ask' },
    });
    expect(texts(`${presetColumn} [aria-checked="true"]`)).toEqual([
      'Plan a feature Claude Code · Ask first',
    ]);
    expect(head()[5]).toBe('Plan a feature');
    expect(document.activeElement).toBe(el.querySelector(`${presetColumn} .action`));

    // Another setting takes the chat off the preset; picking the preset puts it back.
    pick(el, 'Plan only');
    pick(el, 'Low');
    await fixture.whenStable();
    expect(head()[5]).toBe('No preset');
    pick(el, 'Plan a feature');
    await fixture.whenStable();
    expect(head().slice(2)).toEqual(['Extra high effort', 'Ask first', '~', 'Plan a feature']);

    // Once begun in another folder, the chat can't take it.
    pick(el, '~/git/breeder');
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await write(fixture, el, 'First');
    await open('preset');
    const choice = [...el.querySelectorAll(`${presetColumn} .choice`)].find((c) =>
      c.textContent!.includes('Plan a feature'),
    )!;
    expect(choice.getAttribute('aria-disabled')).toBe('true');
    expect(head()[5]).toBe('No preset');
  });
});
