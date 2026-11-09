import type {
  AgentSetup,
  CommandRequest,
  SetupFile,
} from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('workflow-setup', () => {
  it("shows on the Workflow setup page what Claude Code loads in the chat's folder, and where each piece comes from", async () => {
    const { bridge, answers, calls } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    answers['agents.setup'] = (request: CommandRequest<'agents.setup'>): AgentSetup => ({
      cwd: request.cwd ?? 'C:/Users/me',
      sections: {
        ...empty,
        memory: [
          { name: '~/.claude/CLAUDE.md', detail: 'Your instructions, in every folder', source: 'user', path: 'C:/Users/me/.claude/CLAUDE.md', tokens: 310 },
        ],
        skills: [
          { name: 'deploy', source: 'plugin', plugin: 'ship', tokens: 60 },
          { name: 'notes', source: 'user' },
          { name: 'wrangler', detail: 'Cloudflare Workers CLI', source: 'user', tokens: 2148 },
        ],
        mcpServers: [{ name: 'github', detail: 'Failed to connect', source: 'project', problem: 'spawn gh-mcp ENOENT' }],
      },
      settingsFiles: [
        { source: 'user', path: 'C:/Users/me/.claude/settings.json', exists: true },
        { source: 'project', path: 'C:/Users/me/git/new/.claude/settings.json', exists: false },
      ],
      at: Date.now(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Front matter')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-tab-page .title')).toEqual(['Front matter']);
    expect(texts('gr-workflow-setup-page .sub')[0]).toMatch(/^In ~\s*·\s*Another folder\s*·\s*read at .+\s*·\s*Read again$/);
    expect(texts('gr-workflow-setup-page h2')).toEqual(['Claude Code']);
    expect(texts('gr-workflow-setup-page summary .part')).toEqual([
      'Memory',
      'Skills',
      'Subagents',
      'Commands',
      'Hooks',
      'MCP servers',
      'Plugins',
      'Permissions',
      'Settings files',
    ]);
    expect(texts('gr-workflow-setup-page summary .n')).toEqual([
      '1 · 310 tokens',
      '3 · 2,208 tokens',
      '0',
      '0',
      '0',
      '1',
      '0',
      '0',
      '2',
    ]);
    const section = (name: string) => `gr-workflow-setup-page [data-section="${name}"]`;
    // Each row's cells: its name, whose it is, what it does, and its cost.
    const rows = (name: string) =>
      [...el.querySelectorAll(`${section(name)} li`)].map((row) =>
        [...row.children].map((cell) => cell.textContent!.trim()).join(' | '),
      );
    // The costliest first, those without a cost last; the heavy ones flagged.
    expect(rows('skills')).toEqual([
      'wrangler | Yours | Cloudflare Workers CLI | 2,148 tokens',
      'deploy | ship |  | 60 tokens',
      'notes | Yours |  | ',
    ]);
    expect(texts(`${section('skills')} li.heavy .name`)).toEqual(['wrangler']);
    expect(el.querySelector(`${section('skills')} li.heavy .n`)!.getAttribute('title')).toBe(
      'Heavy: 2,000 tokens or more in every chat',
    );
    expect(el.querySelector(`${section('memory')} .name`)!.getAttribute('title')).toBe('C:/Users/me/.claude/CLAUDE.md');
    expect(texts(`${section('mcpServers')} .problem`)).toEqual(['spawn gh-mcp ENOENT']);
    expect(texts(`${section('hooks')} .none`)).toEqual(['None.']);
    expect(rows('settings')).toEqual([
      '~/.claude/settings.json | Yours |  | ',
      '~/git/new/.claude/settings.json | Project | None yet | ',
    ]);
    expect(calls.filter((c) => c.command === 'agents.setup').map((c) => c.request)).toEqual([
      { agent: 'claude-code' },
    ]);

    // Another folder reads it again there.
    [...el.querySelectorAll<HTMLButtonElement>('gr-workflow-setup-page .sub .gr-link')]
      .find((link) => link.textContent!.includes('Another folder'))!
      .click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.setup').at(-1)!.request).toEqual({
      agent: 'claude-code',
      cwd: 'C:/Users/me/git/new',
    });
    expect(texts('gr-workflow-setup-page .sub')[0]).toMatch(/^In ~\/git\/new\s*·/);
  });

  it('opens a file of the setup on the Workflow setup page, to change and save in place', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    const memory = 'C:/Users/me/.claude/CLAUDE.md';
    const managed = 'C:/Program Files/ClaudeCode/managed-settings.json';
    answers['agents.setup'] = (): AgentSetup => ({
      cwd: 'C:/Users/me',
      sections: { ...empty, memory: [{ name: '~/.claude/CLAUDE.md', source: 'user', path: memory, tokens: 310 }] },
      settingsFiles: [{ source: 'managed', path: managed, exists: true }],
      at: Date.now(),
    });
    let kept = '# Mine';
    answers['agents.openSetupFile'] = (request: CommandRequest<'agents.openSetupFile'>): SetupFile => ({
      path: request.path,
      text: request.path === memory ? kept : '{ "permissions": {} }',
      exists: true,
      changedAt: 100,
      editable: request.path === memory,
    });
    answers['agents.saveSetupFile'] = (request: CommandRequest<'agents.saveSetupFile'>): SetupFile => {
      if (request.text.includes('oops')) throw new Error('It changed on disk since you opened it.');
      kept = request.text;
      return { path: request.path, text: kept, exists: true, changedAt: 200, editable: true };
    };
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Front matter')!
      .click();
    await fixture.whenStable();
    const link = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-workflow-setup-page .gr-link')].find((b) =>
        b.textContent!.includes(text),
      )!;
    const editor = () => el.querySelector<HTMLTextAreaElement>('gr-workflow-setup-page textarea');
    const type = async (text: string) => {
      editor()!.value = text;
      editor()!.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const press = async (init: KeyboardEventInit) => {
      editor()!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      await fixture.whenStable();
    };

    el.querySelector<HTMLButtonElement>('gr-workflow-setup-page [data-section="memory"] button.name')!.click();
    await fixture.whenStable();
    expect(calls).toContainEqual({ command: 'agents.openSetupFile', request: { agent: 'claude-code', path: memory } });
    expect(editor()!.value).toBe('# Mine');
    expect(editor()!.readOnly).toBe(false);
    expect(texts('gr-workflow-setup-page gr-file-editor .sub')[0]).toMatch(/^~\/.claude\/CLAUDE.md\s*·\s*Yours\s*·\s*Back to the list$/);
    expect(link('Save').getAttribute('aria-disabled')).toBe('true');

    // Changes can't be left behind unsaved: Esc stays, and so does the Workflow setup page.
    await type('# Mine\nUse tabs.');
    await press({ key: 'Escape' });
    expect(editor()).not.toBeNull();
    expect(el.querySelector('gr-tab-page')).not.toBeNull();
    expect(texts('gr-workflow-setup-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);
    // Nor by the link back, another page tab, or the command palette.
    [...el.querySelectorAll<HTMLButtonElement>('gr-tab-page .row .gr-link')]
      .find((b) => b.textContent!.includes('Back to the'))!
      .click();
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(editor()!.value).toBe('# Mine\nUse tabs.');
    expect(texts('gr-tab-page .title')).toEqual(['Front matter']);
    expect(el.querySelector('gr-command-palette')).toBeNull();
    expect(texts('gr-workflow-setup-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);

    await press({ key: 's', ctrlKey: true });
    expect(calls).toContainEqual({
      command: 'agents.saveSetupFile',
      request: { agent: 'claude-code', path: memory, text: '# Mine\nUse tabs.', changedAt: 100 },
    });
    expect(texts('gr-workflow-setup-page .note')).toEqual(['Saved. Chats begun from now on load it.']);
    expect(link('Save').getAttribute('aria-disabled')).toBe('true');

    await type('# Mine\noops');
    link('Save').click();
    await fixture.whenStable();
    expect(texts('gr-workflow-setup-page .note.alert')).toEqual(['It changed on disk since you opened it.']);
    link('Discard changes').click();
    await fixture.whenStable();
    expect(editor()!.value).toBe('# Mine\nUse tabs.');

    // Back to the list, read again after the save.
    const reads = () => calls.filter((c) => c.command === 'agents.setup').length;
    const before = reads();
    await press({ key: 'Escape' });
    expect(editor()).toBeNull();
    expect(el.querySelector('gr-tab-page')).not.toBeNull();
    expect(reads()).toBe(before + 1);

    // The managed settings open only to read.
    el.querySelector<HTMLButtonElement>('gr-workflow-setup-page [data-section="settings"] button.name')!.click();
    await fixture.whenStable();
    expect(editor()!.readOnly).toBe(true);
    expect(texts('gr-workflow-setup-page .why')).toEqual(['Your organization’s settings, only to read here.']);
    expect(el.querySelector('gr-workflow-setup-page .actions .gr-link')).toBeNull();
  });

  it('reads the Workflow setup page again when a file of its setup changes, and the open file too', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    const memory = 'C:/Users/me/.claude/CLAUDE.md';
    let skills = 1;
    answers['agents.setup'] = (): AgentSetup => ({
      cwd: 'C:/Users/me',
      sections: {
        ...empty,
        memory: [{ name: '~/.claude/CLAUDE.md', source: 'user', path: memory }],
        skills: Array.from({ length: skills }, (_, i) => ({ name: `skill-${i}`, source: 'user' as const })),
      },
      settingsFiles: [],
      at: Date.now(),
    });
    let onDisk = '# Mine';
    answers['agents.openSetupFile'] = (request: CommandRequest<'agents.openSetupFile'>): SetupFile => ({
      path: request.path,
      text: onDisk,
      exists: true,
      changedAt: onDisk.length,
      editable: true,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Front matter')!
      .click();
    await fixture.whenStable();
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const skillCount = () => texts('gr-workflow-setup-page [data-section="skills"] summary .n')[0];
    expect(skillCount()).toBe('1');

    // A change in another folder isn't this page's.
    skills = 2;
    emit('agents.setupChanged', { agent: 'claude-code', cwd: 'D:/elsewhere' });
    await settle();
    expect(skillCount()).toBe('1');
    emit('agents.setupChanged', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(skillCount()).toBe('2');

    // The open file is opened again as it is now, while you haven't changed it.
    el.querySelector<HTMLButtonElement>('gr-workflow-setup-page [data-section="memory"] button.name')!.click();
    await fixture.whenStable();
    const editor = () => el.querySelector<HTMLTextAreaElement>('gr-workflow-setup-page textarea')!;
    onDisk = '# Changed elsewhere';
    skills = 3;
    emit('agents.setupChanged', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('# Changed elsewhere');

    editor().value = '# Mine again';
    editor().dispatchEvent(new Event('input'));
    onDisk = '# Changed once more';
    emit('agents.setupChanged', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('# Mine again');

    // Back at the list, it's read again.
    [...el.querySelectorAll<HTMLButtonElement>('gr-workflow-setup-page .gr-link')]
      .find((b) => b.textContent!.includes('Discard changes'))!
      .click();
    await fixture.whenStable();
    editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(skillCount()).toBe('3');
    expect(calls.filter((c) => c.command === 'agents.setup')).toHaveLength(3);
  });

  it('offers the Workflow setup page of the other folders your chats ran in', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const empty = { memory: [], skills: [], agents: [], commands: [], hooks: [], mcpServers: [], plugins: [], permissions: [] };
    answers['agents.setup'] = (request: CommandRequest<'agents.setup'>): AgentSetup => ({
      cwd: request.cwd ?? 'C:/Users/me',
      sections: empty,
      settingsFiles: [],
      at: Date.now(),
    });
    answers['agents.setupFolders'] = () => ['C:/Users/me/git/grimoire', 'C:/Users/me', 'C:/Users/me/git/breeder'];
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Front matter')!
      .click();
    await fixture.whenStable();

    // The folder shown isn't offered again.
    expect(texts('gr-workflow-setup-page .sub')[0]).toMatch(/^In ~\s*·/);
    expect(texts('gr-workflow-setup-page .elsewhere .gr-link')).toEqual(['~/git/grimoire', '~/git/breeder']);

    [...el.querySelectorAll<HTMLButtonElement>('gr-workflow-setup-page .elsewhere .gr-link')]
      .find((b) => b.textContent!.trim() === '~/git/breeder')!
      .click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.setup').at(-1)!.request).toEqual({
      agent: 'claude-code',
      cwd: 'C:/Users/me/git/breeder',
    });
    expect(texts('gr-workflow-setup-page .sub')[0]).toMatch(/^In ~\/git\/breeder\s*·/);
    // The open chat's folder comes first, to turn back to.
    expect(texts('gr-workflow-setup-page .elsewhere .gr-link')).toEqual(['~', '~/git/grimoire']);
  });
});
