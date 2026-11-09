import type { AgentMemories, CommandRequest, Memory, SetupFile } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('memories', () => {
  it('draws the memories on the Memories page in columns by kind, with their links and errata', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    const memory = (name: string, type: string, links: string[], indexed = true): Memory => ({
      name,
      path: `${folder}/${name}.md`,
      description: `About ${name}`,
      type,
      changedAt: new Date(2026, 9, 31).getTime(),
      links,
      indexed,
    });
    answers['memories.list'] = (request: CommandRequest<'memories.list'>): AgentMemories => ({
      cwd: request.cwd ?? 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: true },
      enabled: true,
      memories: [
        memory('scope-discipline', 'feedback', ['concise-answers']),
        memory('angular-conventions', 'project', []),
        memory('design-tokens', 'project', ['angular-conventions']),
        memory('commit-style', 'feedback', [], false),
        memory('testing-strategy', 'reference', ['commit-style']),
      ],
      problems: [
        'scope-discipline links to [[concise-answers]], which doesn’t exist.',
        'The index leaves out commit-style.',
      ],
      elsewhere: [
        { cwd: 'C:/Users/me/git/breeder', count: 3 },
        { cwd: null, count: 1 },
      ],
      at: Date.now(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-tab-page .title')).toEqual(['Memory map']);
    expect(texts('gr-memories-page .none')[0]).toBe(
      'Claude Code keeps them in ~/.claude/projects/C--Users-me/memory and reads its index in every chat.',
    );
    expect(texts('gr-memories-page h2')).toEqual(['Errata']);
    expect(texts('gr-memories-page .errata li')).toEqual([
      'scope-discipline links to [[concise-answers]], which doesn’t exist.',
      'The index leaves out commit-style.',
    ]);
    expect(texts('gr-memories-page .column h3')).toEqual(['Feedback', 'Projects', 'References']);
    const column = (title: string) =>
      [...el.querySelectorAll('gr-memories-page .column')].find(
        (c) => c.querySelector('h3')!.textContent!.trim() === title,
      )!;
    expect(
      [...column('Projects').querySelectorAll('.name')].map((n) => n.textContent!.trim()),
    ).toEqual(['angular-conventions', 'design-tokens']);
    const card = (name: string) =>
      el.querySelector<HTMLElement>(`gr-memories-page [data-memory="${name}"]`)!;
    expect(
      [...card('scope-discipline').querySelectorAll('.flag')].map((f) => f.textContent!.trim()),
    ).toEqual(['[[concise-answers]] missing']);
    expect(card('commit-style').querySelector('.flag')!.textContent!.trim()).toBe(
      'not in the index',
    );
    // A thread for each link that names a memory.
    expect(el.querySelectorAll('gr-memories-page path.thread')).toHaveLength(2);

    // Pointing at a memory brings its links forward, and sets the rest back.
    card('design-tokens').dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(card('angular-conventions').classList).not.toContain('faded');
    expect(card('commit-style').classList).toContain('faded');
    expect(el.querySelectorAll('gr-memories-page path.thread.lit')).toHaveLength(1);
    card('design-tokens').dispatchEvent(new MouseEvent('mouseleave'));
    await fixture.whenStable();
    expect(el.querySelectorAll('gr-memories-page .card.faded')).toHaveLength(0);

    // Another folder with memories is one click away.
    expect(texts('gr-memories-page .elsewhere .gr-link')).toEqual(['~/git/breeder 3']);
    el.querySelector<HTMLButtonElement>('gr-memories-page .elsewhere .gr-link')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'memories.list').map((c) => c.request)).toEqual([
      { agent: 'claude-code' },
      { agent: 'claude-code', cwd: 'C:/Users/me/git/breeder' },
    ]);
    expect(texts('gr-memories-page .sub')[0]).toMatch(/^In ~\/git\/breeder\s*·/);
  });

  it('says on the Memories page when there are no memories, or memory is off', async () => {
    const { bridge, answers } = fakeBridge();
    let enabled = true;
    answers['memories.list'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder: 'C:/Users/me/.claude/projects/C--Users-me/memory',
      index: { path: 'C:/Users/me/.claude/projects/C--Users-me/memory/MEMORY.md', exists: false },
      enabled,
      memories: [],
      problems: [],
      elsewhere: [],
      at: Date.now(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-memories-page .none')).toEqual([
      'Claude Code keeps them in ~/.claude/projects/C--Users-me/memory with no index yet.',
      'No memories kept for this folder yet.',
    ]);

    enabled = false;
    [...el.querySelectorAll<HTMLButtonElement>('gr-memories-page .gr-link')]
      .find((b) => b.textContent!.includes('Read again'))!
      .click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-memories-page .none.alert')).toEqual([
      'Claude Code keeps no memories here: memory is turned off in its settings.',
    ]);
    expect(el.querySelector('gr-memories-page .map')).toBeNull();
  });

  it('opens a memory from the Memories page to change, turn to its links, or delete', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    const memory = (name: string, type: string, links: string[]): Memory => ({
      name,
      path: `${folder}/${name}.md`,
      description: `About ${name}`,
      type,
      changedAt: 100,
      links,
      indexed: true,
    });
    let memories = [
      memory('angular-conventions', 'project', []),
      memory('design-tokens', 'project', ['angular-conventions', 'gone']),
      memory('testing-strategy', 'reference', ['design-tokens']),
    ];
    const texts_: Record<string, string> = {};
    answers['memories.list'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: true },
      enabled: true,
      memories,
      problems: [],
      elsewhere: [],
      at: Date.now(),
    });
    answers['memories.open'] = (request: CommandRequest<'memories.open'>): SetupFile => ({
      path: request.path,
      text: texts_[request.path] ?? `Text of ${request.path.split('/').at(-1)}`,
      exists: true,
      changedAt: 100,
      editable: true,
    });
    answers['memories.save'] = (request: CommandRequest<'memories.save'>): SetupFile => {
      texts_[request.path] = request.text;
      return {
        path: request.path,
        text: request.text,
        exists: true,
        changedAt: 200,
        editable: true,
      };
    };
    answers['memories.delete'] = (request: CommandRequest<'memories.delete'>) => {
      memories = memories.filter((one) => one.path !== request.path);
    };
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    const link = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-memories-page .gr-link')].find((b) =>
        b.textContent!.trim().startsWith(text),
      )!;
    const editor = () => el.querySelector<HTMLTextAreaElement>('gr-memories-page textarea');
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const type = async (text: string) => {
      editor()!.value = text;
      editor()!.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const path = (name: string) => `${folder}/${name}.md`;

    el.querySelector<HTMLButtonElement>(
      'gr-memories-page [data-memory="design-tokens"] .name button',
    )!.click();
    await settle();
    expect(calls).toContainEqual({
      command: 'memories.open',
      request: { agent: 'claude-code', cwd: 'C:/Users/me', path: path('design-tokens') },
    });
    expect(editor()!.value).toBe('Text of design-tokens.md');
    expect(el.querySelector('gr-memories-page .map')).toBeNull();
    expect(texts('gr-memories-page gr-file-editor .sub')[0]).toMatch(
      /^~\/.claude\/projects\/C--Users-me\/memory\/design-tokens.md\s*·\s*Projects\s*·\s*Back to the map$/,
    );
    expect(texts('gr-memories-page .links')[0]).toMatch(
      /^Links to\s*angular-conventions\s*\[\[gone\]\] missing\s*·\s*Linked from\s*testing-strategy$/,
    );

    // Saved, it's kept as saved.
    await type('Tokens only.');
    link('Save').click();
    await settle();
    expect(calls).toContainEqual({
      command: 'memories.save',
      request: {
        agent: 'claude-code',
        cwd: 'C:/Users/me',
        path: path('design-tokens'),
        text: 'Tokens only.',
        changedAt: 100,
      },
    });
    expect(texts('gr-memories-page .note')).toEqual(['Saved.']);

    // A link turns to that memory; not while there are changes to save.
    [...el.querySelectorAll<HTMLButtonElement>('gr-memories-page .links .to')]
      .find((b) => b.textContent!.trim() === 'angular-conventions')!
      .click();
    await settle();
    expect(editor()!.value).toBe('Text of angular-conventions.md');
    expect(texts('gr-memories-page .links')[0]).toMatch(
      /Links to\s*none\s*·\s*Linked from\s*design-tokens$/,
    );
    await type('Changed.');
    [...el.querySelectorAll<HTMLButtonElement>('gr-memories-page .links .to')]
      .find((b) => b.textContent!.trim() === 'design-tokens')!
      .click();
    await settle();
    expect(editor()!.value).toBe('Changed.');
    expect(texts('gr-memories-page .note.alert')).toEqual([
      'Save your changes, or discard them, first.',
    ]);
    link('Discard changes').click();
    await fixture.whenStable();

    // Deleting asks first, and can be kept.
    link('Delete').click();
    await fixture.whenStable();
    expect(texts('gr-memories-page .ask')).toEqual([
      'Delete it? Its file goes, and its line in the index.',
    ]);
    link('Keep it').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-memories-page .ask')).toBeNull();
    expect(calls.some((c) => c.command === 'memories.delete')).toBe(false);

    link('Delete').click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-memories-page .gr-link.danger')!.click();
    await settle();
    expect(calls).toContainEqual({
      command: 'memories.delete',
      request: {
        agent: 'claude-code',
        cwd: 'C:/Users/me',
        path: path('angular-conventions'),
        changedAt: 100,
      },
    });
    expect(editor()).toBeNull();
    expect(
      [...el.querySelectorAll('gr-memories-page .card .name')].map((n) => n.textContent!.trim()),
    ).toEqual(['design-tokens', 'testing-strategy']);
  });

  it('keeps an open memory with changes from being left by turning the right page away', async () => {
    const { bridge, answers } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    answers['memories.list'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: false },
      enabled: true,
      memories: [
        {
          name: 'tone',
          path: `${folder}/tone.md`,
          type: 'feedback',
          changedAt: 100,
          links: [],
          indexed: false,
        },
      ],
      problems: [],
      elsewhere: [],
      at: Date.now(),
    });
    answers['memories.open'] = (request: CommandRequest<'memories.open'>): SetupFile => ({
      path: request.path,
      text: 'Short answers.',
      exists: true,
      changedAt: 100,
      editable: true,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-memories-page .name button')!.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    const editor = el.querySelector<HTMLTextAreaElement>('gr-memories-page textarea')!;
    editor.value = 'Shorter answers.';
    editor.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-tab-page .row .gr-link')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-memories-page textarea')).not.toBeNull();
    expect(texts('gr-memories-page .note.alert')).toEqual([
      'Save your changes, or discard them, first.',
    ]);

    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await fixture.whenStable();
    expect(el.querySelector('gr-memories-page textarea')).not.toBeNull();
  });

  it('reads the Memories page again when the memories of its folder change, and the open one unless changed', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    const folder = 'C:/Users/me/.claude/projects/C--Users-me/memory';
    const memory = (name: string): Memory => ({
      name,
      path: `${folder}/${name}.md`,
      type: 'feedback',
      changedAt: 100,
      links: [],
      indexed: true,
    });
    let memories = [memory('tone')];
    let text = 'Short answers.';
    answers['memories.list'] = (): AgentMemories => ({
      cwd: 'C:/Users/me',
      folder,
      index: { path: `${folder}/MEMORY.md`, exists: true },
      enabled: true,
      memories,
      problems: [],
      elsewhere: [],
      at: Date.now(),
    });
    answers['memories.open'] = (request: CommandRequest<'memories.open'>): SetupFile => ({
      path: request.path,
      text,
      exists: true,
      changedAt: 100,
      editable: true,
    });
    const { fixture, el } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Memory map')!
      .click();
    await fixture.whenStable();
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const names = () =>
      [...el.querySelectorAll('gr-memories-page .card .name')].map((n) => n.textContent!.trim());
    const reads = () => calls.filter((c) => c.command === 'memories.list').length;
    expect(names()).toEqual(['tone']);

    // Another folder's memories changing reads nothing.
    emit('memories.changed', { agent: 'claude-code', cwd: 'D:/elsewhere' });
    await settle();
    expect(reads()).toBe(1);

    memories = [memory('tone'), memory('commits')];
    emit('memories.changed', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(names()).toEqual(['tone', 'commits']);

    // The open memory is opened again as it is on disk, while you haven't changed it.
    el.querySelector<HTMLButtonElement>(
      'gr-memories-page [data-memory="tone"] .name button',
    )!.click();
    await settle();
    const editor = () => el.querySelector<HTMLTextAreaElement>('gr-memories-page textarea')!;
    text = 'Shorter answers.';
    emit('memories.changed', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('Shorter answers.');

    // Not once you have.
    editor().value = 'Mine.';
    editor().dispatchEvent(new Event('input'));
    await fixture.whenStable();
    text = 'Theirs.';
    emit('memories.changed', { agent: 'claude-code', cwd: 'C:/Users/me' });
    await settle();
    expect(editor().value).toBe('Mine.');
  });
});
