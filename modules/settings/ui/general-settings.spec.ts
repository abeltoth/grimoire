import type {
  AgentSetup,
  CommandRequest,
  GrimoireSettings,
  OpenChat,
  Preset,
} from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

describe('general-settings', () => {
  it('keeps the settings with the service, and the book follows them', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
      (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('#gr-settings-general ~ .form .word')].find(
        (button) => button.textContent!.trim() === text,
      )!;
    const checked = () => texts('#gr-settings-general ~ .form .word[aria-checked="true"]');
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-tab-page .title')).toEqual(['Colophon']);
    expect(texts('section[aria-labelledby="gr-settings-general"] .label')).toEqual([
      'Names',
      'Drawings',
      'Default agent for new chapters',
      'New chapters begin with',
      'Suggest the next entry',
      'Suggest separate chapters',
      'MCP servers in every chapter',
      'Jira issues on the Kanban board',
      'Jira query',
    ]);
    expect(checked()).toEqual([
      'The book’s',
      'Drawn',
      'The one used last',
      'Your last settings',
      'On',
      'On',
      'On',
    ]);
    expect(texts('gr-settings-page [aria-labelledby="gr-settings-mcp"] .none')).toEqual(['None']);

    word('Plain').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { wording: 'plain' },
    ]);
    expect(texts('gr-page-tabs .page-tab:not(.command-palette)')).toEqual([
      'History',
      'Workflow setup',
      'Kanban',
      'Memories',
      'Scheduled chats',
      'Usage',
      'Terminal',
      'Settings',
    ]);
    expect(texts('gr-tab-page .title')).toEqual(['Settings']);
    expect(texts('gr-tab-page .row .gr-link')).toEqual(['Back to Plan Esc']);
    expect(texts('section[aria-labelledby="gr-settings-general"] .label')[2]).toBe(
      'Default agent for new chats',
    );
    expect(texts('gr-chat-tab.new b')).toEqual(['New chat']);

    word('Left out').click();
    await fixture.whenStable();
    expect(document.documentElement.dataset['drawings']).toBe('off');

    const jql = el.querySelector<HTMLTextAreaElement>('#gr-settings-jira')!;
    expect(jql.value).toBe(DEFAULT_SETTINGS.jiraQuery);
    jql.value = ' project = GRIM ';
    jql.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    jql.value = ' ';
    jql.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(
      calls
        .filter((c) => c.command === 'settings.set')
        .slice(-2)
        .map((c) => c.request),
    ).toEqual([{ jiraQuery: 'project = GRIM' }, { jiraQuery: DEFAULT_SETTINGS.jiraQuery }]);
    expect(jql.value).toBe(DEFAULT_SETTINGS.jiraQuery);

    // Jira turned off is never fetched.
    [...el.querySelectorAll<HTMLButtonElement>('[aria-labelledby="gr-settings-jira-on"] .word')]
      .find((button) => button.textContent!.trim() === 'Off')!
      .click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'settings.set').at(-1)!.request).toEqual({
      jira: false,
    });

    // Another window changed them back.
    kept = { ...DEFAULT_SETTINGS };
    emit('settings.changed', { settings: kept });
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Colophon']);
    expect(document.documentElement.dataset['drawings']).toBe('on');

    answers['settings.set'] = () => {
      throw new Error('the service is busy');
    };
    word('Plain').click();
    await fixture.whenStable();
    expect(checked()[0]).toBe('The book’s');
    expect(texts('gr-settings-page [role="alert"]')).toEqual([
      'That setting couldn’t be kept: the service is busy',
    ]);
  });

  it('turns MCP servers off in every chat in Settings', async () => {
    const { bridge, answers, calls } = fakeBridge();
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
          { name: 'github', source: 'user', tokens: 4200 },
          { name: 'claude.ai Gmail', source: 'account' },
        ],
      },
      settingsFiles: [],
      at: new Date(2026, 10, 9, 15, 30).getTime(),
    });
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, mcpOff: ['linear'] };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
      (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    const row = 'gr-settings-page [aria-labelledby="gr-settings-mcp"]';
    // Those your agents load, and those turned off they no longer list; the ones on underlined.
    expect(texts(`${row} .word`)).toEqual(['github', 'claude.ai Gmail', 'linear']);
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['github', 'claude.ai Gmail']);

    el.querySelector<HTMLButtonElement>(`${row} .word`)!.click();
    await fixture.whenStable();
    el.querySelectorAll<HTMLButtonElement>(`${row} .word`)[2]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { mcpOff: ['linear', 'github'] },
      { mcpOff: ['github'] },
    ]);
    // One turned on again that no agent lists any more is gone.
    expect(texts(`${row} .word`)).toEqual(['github', 'claude.ai Gmail']);
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['claude.ai Gmail']);
  });

  it('begins new chats with the default agent, or the preset Settings names', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.list'] = () => [
      { id: 'claude-code', name: 'Claude Code', capabilities: [] },
      { id: 'codex', name: 'Codex', capabilities: [] },
    ];
    answers['presets.list'] = (): Preset[] => [
      { name: 'Bug fix', agent: 'codex', settings: { mode: 'accept-edits' } },
    ];
    let kept: GrimoireSettings = {
      ...DEFAULT_SETTINGS,
      newChat: { from: 'preset', preset: 'Bug fix' },
    };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
      (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);

    // The blank page it opens on begins with the preset too.
    expect(texts('.meta button')[0]).toBe('Codex');
    expect(texts('.meta button').at(-1)).toBe('Bug fix');
    expect(texts('gr-chat-tab.new i')).toEqual(['Bug fix · Ctrl+N']);

    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    expect(texts('#gr-settings-general ~ .form .word[aria-checked="true"]').slice(2, 4)).toEqual([
      'The one used last',
      'Bug fix',
    ]);
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('#gr-settings-general ~ .form .word')].find(
        (button) => button.textContent!.trim() === text,
      )!;
    word('Your last settings').click();
    word('Claude Code').click();
    await fixture.whenStable();
    expect(kept.newChat).toEqual({ from: 'last-used' });
    expect(kept.defaultAgent).toBe('claude-code');
    expect(texts('gr-chat-tab.new i')).toEqual(['Last settings · Ctrl+N']);

    el.querySelector<HTMLButtonElement>('gr-chat-tab.new button')!.click();
    await fixture.whenStable();
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
  });

  it('speaks plainly everywhere once Settings says so', async () => {
    const { bridge, answers } = fakeBridge();
    answers['settings.get'] = (): GrimoireSettings => ({ ...DEFAULT_SETTINGS, wording: 'plain' });
    const waiting = (id: string, title: string, command: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/Users/me/git/grimoire' },
      status: 'waiting',
      entries: [{ kind: 'user', id: 'u1', text: 'Run the tests' }],
      approvals: [{ id: `${id}-seal`, chatId: id, tool: 'Bash', input: { command }, at: 1 }],
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [waiting('c1', 'Fix flaky login test', 'npm test')];
    answers['agents.chats'] = () => [
      { id: 'c1', agent: 'claude-code', title: 'Fix flaky login test', updatedAt: 1 },
    ];
    answers['layout.get'] = () => ({ current: 'c1', lastUsed: null });
    const { fixture, el, texts } = await render(bridge);
    // The book's own words, which plain wording has none of; the TOOL names and code stay as they are.
    const BOOK =
      /\b(chapters?|entry|entries|seals?|sealed|sealing|slips?|facing page|index|outline|colophon|ledger|scriptorium|table of contents|front matter|memory map|look up|thumb|begun)\b/i;
    const bookWords = () => {
      // The theme file's own headings are its source, as its token names are.
      const book = el.cloneNode(true) as HTMLElement;
      book.querySelectorAll('gr-theme-editor summary').forEach((heading) => heading.remove());
      const said = [
        book.textContent!,
        ...[...book.querySelectorAll('[aria-label], [placeholder], [title]')].flatMap((node) =>
          ['aria-label', 'placeholder', 'title'].map((name) => node.getAttribute(name) ?? ''),
        ),
      ].join('\n');
      return said
        .split('\n')
        .filter((line) => BOOK.test(line))
        .map((line) => line.trim());
    };
    const pageTab = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
        .find((tab) => tab.textContent!.trim() === label)!
        .click();

    expect(bookWords()).toEqual([]);
    expect(texts('gr-chat-tab.approvals b')).toEqual(['Waiting for approval']);

    el.querySelector<HTMLButtonElement>('gr-chat-tab.approvals button')!.click();
    await fixture.whenStable();
    expect(texts('gr-approvals-page .title')).toEqual(['Waiting for approval']);
    expect(texts('gr-approvals-page .hint')).toEqual(['1 request from 1 chat, oldest first']);
    expect(bookWords()).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-command-palette .title')).toEqual(['Command palette']);
    expect(texts('gr-command-palette h3')).toEqual(['Actions', 'Chats']);
    expect(bookWords()).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();

    pageTab('History');
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['History']);
    expect(bookWords()).toEqual([]);
    for (const label of ['Scheduled chats', 'Terminal', 'Settings']) {
      pageTab(label);
      await fixture.whenStable();
      expect(texts('gr-tab-page .title')).toEqual([label]);
      expect(bookWords()).toEqual([]);
    }
    el.querySelector<HTMLButtonElement>('.meta button')!.click();
    await fixture.whenStable();
    expect(texts('gr-settings-card h2')).toEqual(['Settings for this chat']);
    expect(bookWords()).toEqual([]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-chat-tab.new button')!.click();
    await fixture.whenStable();
    expect(texts('gr-chat-intro .kicker')).toEqual(['A new chat']);
    expect(bookWords()).toEqual([]);
  });
});
