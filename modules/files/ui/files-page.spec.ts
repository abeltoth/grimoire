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

  it("won't turn back to the folder with changes not saved, until they're discarded", async () => {
    const { bridge, calls } = repository();
    const { fixture, el, texts, button, type } = await openFiles(bridge);
    button('.entry', 'README.md').click();
    await fixture.whenStable();
    await type('# Mine\n');

    button('.gr-link', 'Back to the files').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .note.alert')).toEqual([
      'Save your changes, or discard them, first.',
    ]);
    expect(el.querySelector('gr-code-editor')).not.toBeNull();

    button('.gr-link', 'Discard changes').click();
    await fixture.whenStable();
    button('.gr-link', 'Back to the files').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-code-editor')).toBeNull();
    expect(texts('gr-files-page h3')).toEqual(['Not committed yet', 'All its files']);
    expect(calls).toContainEqual({
      command: 'files.close',
      request: { cwd: 'C:/Users/me', path: 'README.md' },
    });
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
});
