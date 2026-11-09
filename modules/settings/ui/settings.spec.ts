import type {
  AgentSetup,
  AgentSignIn,
  CommandRequest,
  GrimoireSettings,
  OpenChat,
  Preset,
  Profiles,
} from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { DENSITIES, TEXT_FONTS } from './theme';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('settings', () => {
  describe('profiles', () => {
    const personal = { id: 'personal', name: 'Personal', claudeFolder: null };
    const work = { id: 'work', name: 'Work', claudeFolder: 'C:/Users/me/AppData/Grimoire/profiles/work/claude' };

    function withProfiles(active = 'personal') {
      const fake = fakeBridge();
      let list: Profiles = { active, profiles: [personal, work] };
      fake.answers['profiles.list'] = () => list;
      fake.answers['profiles.switch'] = ({ id }: { id: string }) => {
        list = { ...list, active: id };
        fake.emit('profiles.changed', { profiles: list });
        return list;
      };
      fake.answers['profiles.create'] = ({ name }: { name: string }) => {
        const made = { id: name.toLowerCase(), name, claudeFolder: `C:/Users/me/AppData/Grimoire/profiles/${name.toLowerCase()}/claude` };
        list = { ...list, profiles: [...list.profiles, made] };
        return list;
      };
      fake.answers['profiles.rename'] = ({ id, name }: { id: string; name: string }) => {
        list = { ...list, profiles: list.profiles.map((p) => (p.id === id ? { ...p, name } : p)) };
        return list;
      };
      return fake;
    }

    const openSettings = async (el: HTMLElement, fixture: { whenStable(): Promise<unknown> }) => {
      [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
        .find((tab) => tab.textContent!.trim() === 'Colophon')!
        .click();
      await fixture.whenStable();
    };
    const button = (el: HTMLElement, scope: string, text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find(
        (b) => b.textContent!.replace(/\s+/g, ' ').trim() === text,
      )!;

    it('names the profile in use on the title bar, and switches from its menu', async () => {
      const { bridge, calls, emit } = withProfiles();
      const { fixture, el, texts } = await render(bridge);
      expect(texts('gr-title-bar .window-title')).toEqual(['Personal']);

      el.querySelector<HTMLButtonElement>('gr-title-bar .window-title')!.click();
      await fixture.whenStable();
      expect(texts('gr-title-bar [role="menu"] .item')).toEqual(['Personal', 'Work', 'Manage…']);
      expect(texts('gr-title-bar [aria-checked="true"]')).toEqual(['Personal']);

      button(el, 'gr-title-bar [role="menu"]', 'Work').click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'profiles.switch')).toEqual([
        { command: 'profiles.switch', request: { id: 'work' } },
      ]);
      expect(el.querySelector('gr-title-bar [role="menu"]')).toBeNull();
      expect(texts('gr-title-bar .window-title')).toEqual(['Work']);

      // Another window switched, or renamed it.
      emit('profiles.changed', {
        profiles: { active: 'work', profiles: [personal, { ...work, name: 'Office' }] },
      });
      await fixture.whenStable();
      expect(texts('gr-title-bar .window-title')).toEqual(['Office']);
    });

    it('says why a switch was refused', async () => {
      const { bridge, answers } = withProfiles();
      answers['profiles.switch'] = () => {
        throw new Error('Can’t switch to "Work" yet. Wait for "Fix the ribbon" to finish, or stop it, first');
      };
      const { fixture, el, texts } = await render(bridge);
      el.querySelector<HTMLButtonElement>('gr-title-bar .window-title')!.click();
      await fixture.whenStable();
      button(el, 'gr-title-bar [role="menu"]', 'Work').click();
      await fixture.whenStable();

      expect(texts('gr-title-bar [role="alert"]')).toEqual([
        'Can’t switch to "Work" yet. Wait for "Fix the ribbon" to finish, or stop it, first Dismiss',
      ]);
      expect(texts('gr-title-bar .window-title')).toEqual(['Personal']);
      button(el, 'gr-title-bar [role="alert"]', 'Dismiss').click();
      await fixture.whenStable();
      expect(el.querySelector('gr-title-bar [role="alert"]')).toBeNull();
    });

    it('opens the profiles in Settings from the menu, to make, rename and delete them', async () => {
      const { bridge, calls } = withProfiles('work');
      const { fixture, el, texts } = await render(bridge);
      el.querySelector<HTMLButtonElement>('gr-title-bar .window-title')!.click();
      await fixture.whenStable();
      button(el, 'gr-title-bar [role="menu"]', 'Manage…').click();
      await fixture.whenStable();

      expect(texts('gr-tab-page .title')).toEqual(['Colophon']);
      const section = 'section[aria-labelledby="gr-settings-profiles"]';
      expect(texts(`${section} h2`)).toEqual(['Volumes']);
      expect(texts(`${section} h3`)).toEqual(['Personal', 'Work open now']);
      expect(texts(`${section} .sub code`)).toEqual([
        '~/.claude',
        '~/AppData/Grimoire/profiles/work/claude',
      ]);
      // Neither Personal nor the profile in use can be deleted.
      const deletes = () =>
        [...el.querySelectorAll<HTMLButtonElement>(`${section} .profile .actions button`)]
          .filter((b) => b.textContent!.trim() === 'Delete')
          .map((b) => b.disabled);
      expect(deletes()).toEqual([true, true]);

      // A new profile, which asks to be signed in.
      button(el, section, 'New volume').click();
      await fixture.whenStable();
      const field = el.querySelector<HTMLInputElement>(`${section} .profile-field`)!;
      field.value = 'Side';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'profiles.create')).toEqual([
        { command: 'profiles.create', request: { name: 'Side' } },
      ]);
      expect(texts(`${section} h3`)).toEqual(['Personal', 'Work open now', 'Side']);
      expect(texts(`${section} [role="status"]`)).toEqual([
        'Not signed in yet: Claude Code signs in afresh in its Claude folder. Open it and sign in',
      ]);
      expect(deletes()).toEqual([true, true, false]);

      // Renamed in place.
      const renames = [...el.querySelectorAll<HTMLButtonElement>(`${section} .profile .actions button`)].filter(
        (b) => b.textContent!.trim() === 'Rename',
      );
      renames[2]!.click();
      await fixture.whenStable();
      const name = el.querySelector<HTMLInputElement>(`${section} .name-field`)!;
      name.value = 'Side project';
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'profiles.rename')).toEqual([
        { command: 'profiles.rename', request: { id: 'side', name: 'Side project' } },
      ]);
      expect(texts(`${section} h3`)).toEqual(['Personal', 'Work open now', 'Side project']);

      // Deleting says where the Claude folder stays.
      const lastDelete = [...el.querySelectorAll<HTMLButtonElement>(`${section} .profile .actions button`)]
        .filter((b) => b.textContent!.trim() === 'Delete')
        .at(-1)!;
      lastDelete.click();
      await fixture.whenStable();
      expect(texts(`${section} .ask`)).toEqual([
        'Delete “Side project”? Its settings, presets and scheduled chats go. Its Claude folder, with its chapters, stays at C:/Users/me/AppData/Grimoire/profiles/side/claude.',
      ]);
    });

    it('switches to a new profile to sign it in, then asks for the account once the window is back', async () => {
      const { bridge, answers, calls } = withProfiles();
      answers['agents.list'] = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['sign-in'] }];
      answers['agents.account'] = (): AgentSignIn => ({ agent: 'claude-code', account: null, pending: null });
      const { fixture, el, texts } = await render(bridge);
      await openSettings(el, fixture);
      const section = 'section[aria-labelledby="gr-settings-profiles"]';
      button(el, section, 'New volume').click();
      await fixture.whenStable();
      const field = el.querySelector<HTMLInputElement>(`${section} .profile-field`)!;
      field.value = 'Side';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await fixture.whenStable();
      button(el, section, 'Open it and sign in').click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'profiles.switch')).toEqual([
        { command: 'profiles.switch', request: { id: 'side' } },
      ]);
      // The window opens again on the new profile, kept in mind across the reload.
      expect(sessionStorage.getItem('grimoire.signInNext')).toBe('side');
      sessionStorage.removeItem('grimoire.signInNext');
      expect(texts('gr-title-bar .window-title')).toEqual(['Side']);
    });

    it('opens Settings on the account to sign in as, after switching to sign in', async () => {
      const { bridge, answers } = withProfiles('work');
      answers['agents.list'] = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['sign-in'] }];
      answers['agents.account'] = (): AgentSignIn => ({ agent: 'claude-code', account: null, pending: null });
      sessionStorage.setItem('grimoire.signInNext', 'work');
      const { fixture, el, texts } = await render(bridge);
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
      expect(texts('gr-tab-page .title')).toEqual(['Colophon']);
      expect(document.activeElement).toBe(el.querySelector('gr-settings-page .account-field'));
      expect(sessionStorage.getItem('grimoire.signInNext')).toBeNull();
    });

    it('lists the other profiles in the command palette, in the book’s words or plainly', async () => {
      const { bridge, emit } = withProfiles();
      const { fixture, texts } = await render(bridge);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      await fixture.whenStable();
      expect(texts('gr-command-palette .entry .label')).toContain('Open the Work volume');
      expect(texts('gr-command-palette .entry .label')).not.toContain('Open the Personal volume');

      emit('settings.changed', { settings: { ...DEFAULT_SETTINGS, wording: 'plain' } });
      await fixture.whenStable();
      expect(texts('gr-command-palette .entry .label')).toContain('Switch to Work');
    });
  });

  it('keeps the settings with the service, and the book follows them', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
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
    ]);
    expect(checked()).toEqual(['The book’s', 'Drawn', 'The one used last', 'Your last settings', 'On', 'On']);
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
    expect(texts('section[aria-labelledby="gr-settings-general"] .label')[2]).toBe('Default agent for new chats');
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
    expect(calls.filter((c) => c.command === 'settings.set').slice(-2).map((c) => c.request)).toEqual([
      { jiraQuery: 'project = GRIM' },
      { jiraQuery: DEFAULT_SETTINGS.jiraQuery },
    ]);
    expect(jql.value).toBe(DEFAULT_SETTINGS.jiraQuery);

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
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    answers['agents.setup'] = (request: CommandRequest<'agents.setup'>): AgentSetup => ({
      cwd: request.cwd ?? 'C:/Users/me',
      sections: {
        ...empty,
        mcpServers: [
          { name: 'github', source: 'user', tokens: 4200 },
          { name: 'claude.ai Gmail', source: 'account' },
        ],
      },
      settingsFiles: [],
      at: Date.now(),
    });
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, mcpOff: ['linear'] };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
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
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);

    // The blank page it opens on begins with the preset too.
    expect(texts('.meta button')[0]).toBe('Codex');
    expect(texts('.meta button').at(-1)).toBe('Bug fix');
    expect(texts('gr-chat-tab.new i')).toEqual(['Bug fix · Ctrl+N']);

    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    expect(
      texts('#gr-settings-general ~ .form .word[aria-checked="true"]').slice(2, 4),
    ).toEqual(['The one used last', 'Bug fix']);
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
      pins: [],
      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [waiting('c1', 'Fix flaky login test', 'npm test')];
    answers['agents.chats'] = () => [
      { id: 'c1', agent: 'claude-code', title: 'Fix flaky login test', updatedAt: 1, pins: [], tags: [] },
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
      return said.split('\n').filter((line) => BOOK.test(line)).map((line) => line.trim());
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

  it('switches the account Claude Code signs in as in Settings, for every chat', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    answers['agents.list'] = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['sign-in'] }];
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, accounts: ['mum@example.com'] };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const me = { email: 'me@example.com', plan: 'pro', expiresAt: null };
    answers['agents.account'] = (): AgentSignIn => ({ agent: 'claude-code', account: me, pending: null });
    let finish!: (state: AgentSignIn) => void;
    let fail!: (error: Error) => void;
    answers['agents.signIn'] = () =>
      new Promise<AgentSignIn>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    const row = '[aria-labelledby="gr-settings-account"]';
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>(`${row} .word`)].find(
        (button) => button.textContent!.trim() === text,
      )!;
    const link = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-settings-page .gr-link')].find(
        (button) => button.textContent!.trim() === text,
      )!;
    const signIns = () => calls.filter((c) => c.command === 'agents.signIn').map((c) => c.request);

    expect(texts('section[aria-labelledby="gr-settings-general"] .label').at(-1)).toBe(
      'Claude Code signs in as',
    );
    expect(texts(`${row} .word`)).toEqual(['mum@example.com', 'me@example.com']);
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['me@example.com']);
    expect(texts('gr-settings-page .note').at(-1)).toMatch(/^Pro\. Every chapter uses it/);

    // Signing in to another keeps the one signed in as, to switch back to.
    word('mum@example.com').click();
    await fixture.whenStable();
    expect(kept.accounts).toEqual(['mum@example.com', 'me@example.com']);
    expect(signIns()).toEqual([{ agent: 'claude-code', email: 'mum@example.com' }]);
    emit('agents.account', {
      agent: 'claude-code',
      account: me,
      pending: { email: 'mum@example.com', url: 'https://example.com/sign-in' },
    });
    await fixture.whenStable();
    expect(texts('gr-settings-page [role="status"]')[0]).toMatch(
      /^Waiting for you to sign in as mum@example\.com in the browser\. Copy the sign-in link Cancel$/,
    );
    expect(word('me@example.com').disabled).toBe(true);
    const code = el.querySelector<HTMLInputElement>('#gr-settings-sign-in-code')!;
    code.value = 'abc#123';
    code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.signInCode')!.request).toEqual({
      agent: 'claude-code',
      code: 'abc#123',
    });

    const mum: AgentSignIn = {
      agent: 'claude-code',
      account: { email: 'mum@example.com', plan: 'max', expiresAt: null },
      pending: null,
    };
    emit('agents.account', mum);
    finish(mum);
    await fixture.whenStable();
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['mum@example.com']);
    expect(texts('gr-settings-page .note').at(-1)).toMatch(/^Max\. /);

    // Forgetting an account takes it off the list only.
    el.querySelector<HTMLButtonElement>(`${row} [aria-label="Forget me@example.com"]`)!.click();
    await fixture.whenStable();
    expect(kept.accounts).toEqual(['mum@example.com']);

    // Another account is signed in to once its email is written; a failure says why.
    link('Another account').click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('gr-settings-page .account-field')!;
    expect(document.activeElement).toBe(field);
    field.value = 'dad@example.com';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(signIns().at(-1)).toEqual({ agent: 'claude-code', email: 'dad@example.com' });
    expect(kept.accounts).toEqual(['mum@example.com', 'dad@example.com']);
    fail(new Error('Login failed: the account is on hold'));
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-settings-page [role="alert"]')).toEqual(['Login failed: the account is on hold']);
  });

  it('keeps presets in Settings, to rename, remove, and give a first entry new chats begin with', async () => {
    const { bridge, answers, calls } = fakeBridge();
    let saved: Preset[] = [
      { name: 'Bug fix', agent: 'claude-code', settings: { mode: 'accept-edits', cwd: 'C:/Users/me/git/breeder' } },
      { name: 'Plan a feature', agent: 'claude-code', settings: { mode: 'plan' } },
    ];
    answers['presets.list'] = () => saved;
    answers['presets.save'] = (preset: Preset) =>
      (saved = saved.map((p) => (p.name === preset.name ? preset : p)));
    answers['presets.rename'] = ({ from, to }: { from: string; to: string }) =>
      (saved = saved.map((p) => (p.name === from ? { ...p, name: to } : p)));
    answers['presets.remove'] = ({ name }: { name: string }) =>
      (saved = saved.filter((p) => p.name !== name));
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    const preset = (name: string) =>
      [...el.querySelectorAll<HTMLElement>('gr-settings-page .preset')].find(
        (article) => article.querySelector('h3')?.textContent!.trim() === name,
      )!;
    const link = (within: HTMLElement, text: string) =>
      [...within.querySelectorAll<HTMLButtonElement>('.gr-link')].find(
        (button) => button.textContent!.trim() === text,
      )!;

    expect(texts('gr-settings-page .preset h3')).toEqual(['Bug fix', 'Plan a feature']);
    expect(texts('gr-settings-page .preset .sub')[0]).toBe('Claude Code · Accept edits · ~/git/breeder');

    const prompt = preset('Bug fix').querySelector<HTMLTextAreaElement>('textarea')!;
    prompt.value = 'Find the failing test and fix it';
    prompt.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'presets.save')!.request).toMatchObject({
      name: 'Bug fix',
      prompt: 'Find the failing test and fix it',
    });

    link(preset('Plan a feature'), 'Rename').click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('gr-settings-page .name-field')!;
    expect(document.activeElement).toBe(field);
    field.value = 'Plan it';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'presets.rename').map((c) => c.request)).toEqual([
      { from: 'Plan a feature', to: 'Plan it' },
    ]);
    expect(texts('gr-settings-page .preset h3')).toEqual(['Bug fix', 'Plan it']);

    link(preset('Plan it'), 'Remove').click();
    await fixture.whenStable();
    expect(texts('gr-settings-page .ask')).toEqual([
      'Remove “Plan it”? Chapters begun with it keep their settings.',
    ]);
    preset('Plan it').querySelector<HTMLButtonElement>('.danger')!.click();
    await fixture.whenStable();
    expect(texts('gr-settings-page .preset h3')).toEqual(['Bug fix']);

    // New chats begin with the preset, its first entry written in.
    [...el.querySelectorAll<HTMLButtonElement>('#gr-settings-general ~ .form .word')]
      .find((word) => word.textContent!.trim() === 'Bug fix')!
      .click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-chat-tab.new button')!.click();
    await fixture.whenStable();
    const entry = el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!;
    expect(entry.value).toBe('Find the failing test and fix it');
    expect(texts('.meta button').at(-1)).toBe('Bug fix');
  });

  it('changes the theme’s tokens in Settings, the book showing each change at once', async () => {
    const { bridge, answers, calls } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const root = document.documentElement.style;
    const sets = () => calls.filter((c) => c.command === 'settings.set').map((c) => c.request);
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fixture.whenStable();
    };
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    for (let i = 0; i < 50 && !el.querySelector('gr-theme-editor details'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fixture.whenStable();
    }

    expect(texts('gr-theme-editor .form .label')).toEqual([
      'Desk',
      'Cover',
      'Paper',
      'Ink',
      'Soft ink',
      'Rubric',
      'Pen',
      'Lapis',
      'Gilt',
      'Size of the text',
      'Face of the text',
      'Room on the page',
    ]);
    expect(texts('gr-theme-editor summary')[0]).toMatch(/^Desk, binding and thumb index\s*\d+$/);
    // Collapsed until opened.
    expect(el.querySelector('gr-theme-editor li')).toBeNull();

    const paper = el.querySelector<HTMLInputElement>('#gr-theme---gr-page')!;
    expect(paper.value).toBe('#f3ebd9');
    paper.value = '#fffaf0';
    paper.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(root.getPropertyValue('--gr-page')).toBe('#fffaf0');
    // Kept once you stop, not at every step.
    paper.value = '#ffffff';
    paper.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(sets()).toEqual([]);
    await settle();
    expect(sets()).toEqual([{ theme: { '--gr-page': '#ffffff' } }]);
    expect(texts('gr-theme-editor .count')).toEqual([expect.stringMatching(/ tokens · 1 changed$/)]);

    const field = el.querySelector<HTMLInputElement>('#gr-theme-search')!;
    field.value = 'composer';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-theme-editor summary')).toEqual([expect.stringMatching(/^Chat: composer\s*\d+$/)]);
    const gap = el.querySelector<HTMLInputElement>('gr-theme-editor input[aria-label="--gr-composer-gap"]')!;
    expect(gap.value).toBe('5px');
    gap.value = '8px';
    gap.dispatchEvent(new Event('change'));
    await settle();
    expect(root.getPropertyValue('--gr-composer-gap')).toBe('8px');
    expect(kept.theme).toEqual({ '--gr-page': '#ffffff', '--gr-composer-gap': '8px' });

    // Written back as drawn, it's no longer changed.
    gap.value = '5px';
    gap.dispatchEvent(new Event('change'));
    await settle();
    expect(kept.theme).toEqual({ '--gr-page': '#ffffff' });
    expect(root.getPropertyValue('--gr-composer-gap')).toBe('');

    [...el.querySelectorAll<HTMLButtonElement>('gr-theme-editor .gr-link')]
      .find((button) => button.textContent!.trim() === 'Reset all')!
      .click();
    await fixture.whenStable();
    expect(kept.theme).toEqual({});
    expect(root.getPropertyValue('--gr-page')).toBe('');
  });

  it('sets the text’s face and the room on the page in Settings, as changes to the theme', async () => {
    const { bridge, answers } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const root = document.documentElement.style;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await fixture.whenStable();
    };
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    for (let i = 0; i < 50 && !el.querySelector('gr-theme-editor details'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fixture.whenStable();
    }
    const group = (name: string) =>
      el.querySelector(`gr-theme-editor [aria-labelledby="gr-theme-${name}"]`)!;
    const words = (name: string) => [...group(name).querySelectorAll<HTMLButtonElement>('.word')];
    const named = (name: string) => words(name).map((button) => button.textContent!.trim());
    const word = (name: string, label: string) => words(name)[named(name).indexOf(label)]!;
    const picked = (name: string) =>
      words(name)
        .filter((button) => button.getAttribute('aria-checked') === 'true')
        .map((button) => button.textContent!.trim());
    const reset = (name: string) =>
      group(name).parentElement!.querySelector<HTMLButtonElement>('.gr-link');
    const [, sans, , mono] = TEXT_FONTS;
    const [compact, , roomy] = DENSITIES;

    expect(named('font')).toEqual(['The book’s', 'Sans-serif', 'Serif', 'Monospace']);
    expect(picked('font')).toEqual(['The book’s']);
    expect(named('density')).toEqual(['Compact', 'Normal', 'Roomy']);
    // Normal is the book as drawn: nothing changed, nothing to reset.
    expect(picked('density')).toEqual(['Normal']);
    expect(reset('font')).toBeNull();
    expect(reset('density')).toBeNull();

    word('font', 'Sans-serif').click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value });
    expect(root.getPropertyValue('--gr-font-text')).toBe(sans!.value);
    expect(picked('font')).toEqual(['Sans-serif']);

    word('density', 'Compact').click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value, ...compact!.tokens });
    expect(root.getPropertyValue('--gr-space-3')).toBe('9px');
    expect(picked('density')).toEqual(['Compact']);
    const changed = Object.keys(compact!.tokens).length + 1;
    expect(texts('gr-theme-editor .count')).toEqual([
      expect.stringMatching(new RegExp(` · ${changed} changed$`)),
    ]);

    // Roomy takes Compact's place; the face stays.
    word('density', 'Roomy').click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value, ...roomy!.tokens });

    // One of its tokens changed by hand is none of the densities.
    const field = el.querySelector<HTMLInputElement>('#gr-theme-search')!;
    field.value = '--gr-space-3';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const space = el.querySelector<HTMLInputElement>(
      'gr-theme-editor input[aria-label="--gr-space-3"]',
    )!;
    expect(space.value).toBe('15px');
    space.value = '14px';
    space.dispatchEvent(new Event('change'));
    await settle();
    expect(picked('density')).toEqual([]);

    reset('density')!.click();
    await settle();
    expect(kept.theme).toEqual({ '--gr-font-text': sans!.value });
    expect(root.getPropertyValue('--gr-space-3')).toBe('');
    expect(picked('density')).toEqual(['Normal']);

    word('font', 'The book’s').click();
    await settle();
    expect(kept.theme).toEqual({});
    expect(root.getPropertyValue('--gr-font-text')).toBe('');
    expect(reset('font')).toBeNull();

    // Another theme starts afresh, the face and the density with it, even before they were kept.
    word('font', 'Monospace').click();
    word('density', 'Compact').click();
    await fixture.whenStable();
    expect(root.getPropertyValue('--gr-font-text')).toBe(mono!.value);
    [...el.querySelectorAll<HTMLButtonElement>('gr-theme-editor .theme')]
      .find((button) => button.querySelector('.theme-name')!.textContent!.trim() === 'Sepia')!
      .click();
    await settle();
    expect(kept.themeName).toBe('sepia');
    expect(kept.theme).toEqual({});
    expect(picked('font')).toEqual(['The book’s']);
    expect(picked('density')).toEqual(['Normal']);
  });

  it('chooses a ready-made theme in Settings, which starts afresh from it', async () => {
    const { bridge, answers } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, theme: { '--gr-page': '#fffaf0' } };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const { fixture, el, texts } = await render(bridge);
    const theme = () => document.documentElement.dataset['theme'];
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-theme-editor .theme-name')).toEqual([
      'Grimoire',
      'Night',
      'Sepia',
      'High contrast',
      'Automatic',
    ]);
    const card = (name: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-theme-editor .theme')].find(
        (button) => button.querySelector('.theme-name')!.textContent!.trim() === name,
      )!;
    expect(card('Grimoire').getAttribute('aria-checked')).toBe('true');
    expect(theme()).toBe('grimoire');

    card('Night').click();
    await fixture.whenStable();
    expect(kept.themeName).toBe('night');
    // The colour changed over Grimoire isn't carried over to Night.
    expect(kept.theme).toEqual({});
    expect(theme()).toBe('night');
    expect(card('Night').getAttribute('aria-checked')).toBe('true');
    expect(card('Grimoire').getAttribute('aria-checked')).toBe('false');

    // Automatic follows the system, which a test's window calls light.
    card('Automatic').click();
    await fixture.whenStable();
    expect(kept.themeName).toBe('auto');
    expect(theme()).toBe('grimoire');
  });
});
