import { write } from '@ui/testing/app-testing';
import { repository, openFiles } from './files-testing';

describe('files-page', () => {
  it('lists what is not committed first, then the folder as a tree it reads as you unfold it', async () => {
    const { bridge, calls } = repository();
    const { fixture, texts, button } = await openFiles(bridge);
    expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
    expect(texts('gr-files-page h2')).toEqual(['~/git/grimoire']);
    expect(texts('gr-files-page h3')).toEqual(['Not committed yet', 'All its files']);
    expect(texts('gr-files-page .list .file')).toEqual([
      'ui/src/ribbon.ts modified',
      'ui/src/seal.ts new',
      'old.txt deleted',
    ]);
    expect(texts('gr-files-page .list button.file')).toHaveLength(2);
    expect(texts('gr-files-page .tree .entry')).toEqual(['dist/', 'ui/', 'logo.png', 'README.md']);
    expect(texts('gr-files-page .entry.ignored')).toEqual(['dist/']);

    button('.entry', 'ui/').click();
    await fixture.whenStable();
    button('.entry', 'src/').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .tree .entry')).toEqual([
      'dist/',
      'ui/',
      'src/',
      'ribbon.ts',
      'seal.ts',
      'logo.png',
      'README.md',
    ]);
    expect(calls.filter((c) => c.command === 'files.list').map((c) => c.request)).toEqual([
      { cwd: 'C:/Users/me', path: '' },
      { cwd: 'C:/Users/me', path: 'ui' },
      { cwd: 'C:/Users/me', path: 'ui/src' },
    ]);

    // Collapsed, and expanded again without reading it twice.
    button('.entry', 'ui/').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .tree .entry')).toEqual(['dist/', 'ui/', 'logo.png', 'README.md']);
    button('.entry', 'ui/').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'files.list')).toHaveLength(3);
  });

  it('opens files in tabs beside the folder, each keeping its changes', async () => {
    const { bridge } = repository();
    const { fixture, el, texts, button, editor, type } = await openFiles(bridge);
    button('.entry', 'README.md').click();
    await fixture.whenStable();
    await type('# Mine\n');
    expect(texts('gr-files-page .file-tab')).toEqual(['README.md ●']);
    // The folder stays beside the file.
    expect(texts('gr-files-page .side .tree .entry')).toContain('README.md');
    expect(texts('gr-files-page .entry.current')).toEqual(['README.md']);

    button('.list .file', 'ui/src/ribbon.ts modified').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .file-tab')).toEqual(['README.md ●', 'ribbon.ts']);
    expect(texts('gr-files-page .file-tab[aria-pressed="true"]')).toEqual(['ribbon.ts']);
    expect(editor()!.value).toBe('export const ribbon = 2;\n');

    button('.file-tab', 'README.md ●').click();
    await fixture.whenStable();
    expect(editor()!.value).toBe('# Mine\n');

    // Opened again, a file turns to its tab rather than opening twice.
    button('.entry', 'README.md').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .file-tab')).toHaveLength(2);

    expect(el.querySelector('gr-files-page .side')).not.toBeNull();
    button('.opened-file:not(.hidden) .gr-link', 'Hide the folder').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-files-page .side')).toBeNull();
    button('.opened-file:not(.hidden) .gr-link', 'Show the folder').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-files-page .side')).not.toBeNull();
  });

  it("won't close a file with changes not saved, until they're discarded", async () => {
    const { bridge, calls } = repository();
    const { fixture, el, texts, button, editor, type } = await openFiles(bridge);
    button('.entry', 'README.md').click();
    await fixture.whenStable();
    await type('# Mine\n');
    const shut = () => el.querySelector<HTMLButtonElement>('gr-files-page .shut')!;

    shut().click();
    await fixture.whenStable();
    expect(texts('gr-files-page .note.alert')).toEqual([
      'Save your changes, or discard them, first.',
    ]);
    expect(el.querySelector('gr-code-editor')).not.toBeNull();

    button('.gr-link', 'Discard changes').click();
    await fixture.whenStable();
    // Ctrl+W in the editor closes the file, as the tab's cross does.
    editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', ctrlKey: true }));
    await fixture.whenStable();
    expect(el.querySelector('gr-code-editor')).toBeNull();
    expect(el.querySelector('gr-files-page .file-tabs')).toBeNull();
    expect(texts('gr-files-page h3')).toEqual(['Not committed yet', 'All its files']);
    expect(calls).toContainEqual({
      command: 'files.close',
      request: { cwd: 'C:/Users/me', path: 'README.md' },
    });
  });

  it('asks what to do when a file changes on disk under your changes, comparing them if you like', async () => {
    const { bridge, emit, disk } = repository();
    const { fixture, texts, button, editor, type } = await openFiles(bridge);
    button('.entry', 'README.md').click();
    await fixture.whenStable();
    await type('# Mine\n');

    disk['README.md'] = { path: 'README.md', text: '# By the agent\n', changedAt: 3 };
    emit('files.changed', { root: 'C:/Users/me/git/grimoire', path: 'README.md' });
    await fixture.whenStable();
    expect(texts('gr-files-page .disk span:first-child')).toEqual([
      'It changed on disk under your changes.',
    ]);
    expect(editor()!.value).toBe('# Mine\n');

    button('.disk .gr-link', 'Compare').click();
    await fixture.whenStable();
    expect(editor('committed')!.value).toBe('# By the agent\n');
    expect(editor()!.value).toBe('# Mine\n');

    button('.disk .gr-link', 'Keep mine').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .disk')).toEqual([]);
    expect(editor('committed')).toBeNull();
    expect(editor()!.value).toBe('# Mine\n');
  });

  it('keeps the open file and its changes while the right page shows another', async () => {
    const { bridge } = repository();
    const { fixture, el, button, editor, type } = await openFiles(bridge);
    button('.entry', 'README.md').click();
    await fixture.whenStable();
    await type('# Mine\n');
    const tab = (label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('.tabs button')].find(
        (t) => t.textContent!.trim() === label,
      )!;
    tab('Outline').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-files-page')).toBeNull();
    tab('Files').click();
    await fixture.whenStable();
    expect(editor()!.value).toBe('# Mine\n');
    expect(button('.gr-link', 'Discard changes')).toBeDefined();
  });

  it('finds files by name', async () => {
    const { bridge, calls } = repository();
    const { fixture, el, texts, button, editor } = await openFiles(bridge);
    const field = el.querySelector<HTMLInputElement>('#gr-files-search')!;
    field.value = 'src';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-files-page h3')).toEqual(['Found']);
    expect(texts('gr-files-page .list .file')).toEqual(['ui/src/ribbon.ts', 'ui/src/seal.ts']);
    expect(calls.filter((c) => c.command === 'files.find').map((c) => c.request)).toEqual([
      { cwd: 'C:/Users/me', query: 'src' },
    ]);

    field.value = 'nothing';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-files-page .none')).toEqual(['No file’s path has those words in it.']);

    field.value = 'seal';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    button('.list .file', 'ui/src/seal.ts').click();
    await fixture.whenStable();
    expect(editor()!.value).toBe('export const seal = 1;\n');
    // Opened from the search, it shows the file alone.
    expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual(['The file']);
  });

  it("says when a file can't be shown", async () => {
    const { bridge } = repository();
    const { fixture, el, texts, button } = await openFiles(bridge);
    button('.entry', 'logo.png').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .none')).toEqual(['It isn’t text, so it can’t be shown here.']);
    expect(el.querySelector('gr-code-editor')).toBeNull();
  });

  it('shows a picture', async () => {
    const { bridge, disk } = repository();
    disk['logo.png'] = { ...disk['logo.png']!, picture: 'data:image/png;base64,iVBORw==' };
    const { fixture, el, texts, button } = await openFiles(bridge);
    button('.entry', 'logo.png').click();
    await fixture.whenStable();
    const picture = el.querySelector<HTMLImageElement>('gr-files-page .picture')!;
    expect(picture.getAttribute('src')).toBe('data:image/png;base64,iVBORw==');
    expect(picture.alt).toBe('logo.png');
    expect(texts('gr-files-page .none')).toEqual([]);
  });

  it('shows Markdown as it reads, and an SVG drawn, keeping the source to turn back to', async () => {
    const { bridge, disk } = repository();
    disk['logo.svg'] = {
      path: 'logo.svg',
      text: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      changedAt: 1,
    };
    const { fixture, el, texts, button, editor } = await openFiles(bridge);
    button('.entry', 'README.md').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .show button')).toEqual(['The file', 'As it reads']);

    button('.show button', 'As it reads').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .preview gr-markdown')).toEqual(['Grimoire']);
    expect(el.querySelector('gr-files-page gr-code-editor.hidden')).not.toBeNull();
    button('.show button', 'The file').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-files-page .preview')).toBeNull();
    expect(editor()!.value).toBe('# Grimoire\n');

    const field = el.querySelector<HTMLInputElement>('#gr-files-search')!;
    field.value = 'logo.svg';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    button('.list .file', 'logo.svg').click();
    await fixture.whenStable();
    button('.opened-file:not(.hidden) .show button', 'As it reads').click();
    await fixture.whenStable();
    expect(
      el.querySelector('gr-files-page .opened-file:not(.hidden) .picture')!.getAttribute('src'),
    ).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`,
    );
  });

  it('lists the files the open chat’s agent changed, the latest first', async () => {
    const { bridge, emit, calls } = repository();
    const { fixture, el, texts, button } = await openFiles(bridge);
    await write(fixture, el, 'Fix the ribbon');
    const edit = (id: string, file: string, isError = false) => ({
      kind: 'tool' as const,
      id,
      tool: 'Edit',
      input: { file_path: file },
      result: { text: '', isError, ...(isError ? {} : { changed: file }) },
    });
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'agent',
        id: 'a1',
        blocks: [
          edit('t1', 'C:/Users/me/git/grimoire/ui/src/seal.ts'),
          edit('t2', 'C:\\Users\\me\\git\\grimoire\\ui\\src\\ribbon.ts'),
          edit('t3', 'C:/Users/me/git/grimoire/README.md', true),
        ],
      },
    });
    await fixture.whenStable();
    expect(texts('gr-files-page h3')).toEqual([
      'Changed in this chapter',
      'Not committed yet',
      'All its files',
    ]);
    expect(texts('gr-files-page .touched .file')).toEqual(['ui/src/ribbon.ts', 'ui/src/seal.ts']);

    button('.touched .file', 'ui/src/ribbon.ts').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'files.open').at(-1)?.request).toEqual({
      cwd: 'C:/work/grimoire',
      path: 'C:\\Users\\me\\git\\grimoire\\ui\\src\\ribbon.ts',
    });
  });

  it('adds what’s selected in a file to the chat’s message, with where it’s from', async () => {
    const { bridge } = repository();
    const { fixture, el, button, actions } = await openFiles(bridge);
    button('.entry', 'README.md').click();
    await fixture.whenStable();
    const add = actions.find((action) => action.id === 'grimoire.addToChat')!;
    expect(add.label).toBe('Add to the chapter');

    const editor = (selected: string, from: number, to: number, endColumn: number) => ({
      getModel: () => ({
        getValueInRange: () => selected,
        getLineContent: () => '# Grimoire',
      }),
      getSelection: () => ({
        startLineNumber: from,
        endLineNumber: to,
        endColumn,
        isEmpty: () => !selected,
      }),
    });
    add.run(editor('# Grimoire\n', 1, 2, 1));
    await fixture.whenStable();
    const message = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
    expect(message.value).toBe('`README.md:1`\n\n```md\n# Grimoire\n```');

    // With nothing selected, the cursor's line goes.
    add.run(editor('', 3, 3, 1));
    await fixture.whenStable();
    expect(message.value).toBe(
      '`README.md:1`\n\n```md\n# Grimoire\n```\n\n`README.md:3`\n\n```md\n# Grimoire\n```',
    );
  });
});
