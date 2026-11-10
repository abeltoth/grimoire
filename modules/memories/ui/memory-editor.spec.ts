import type { AgentMemories, CommandRequest, Memory, SetupFile } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('memory-editor', () => {
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
});
