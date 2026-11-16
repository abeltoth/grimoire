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

  it('lays Files alone on a single page, and back beside the chat at Two pages', async () => {
    const { bridge, calls } = repository();
    const { fixture, el, texts, button } = await openFiles(bridge);
    button('.head .gr-link', 'Single page').click();
    await fixture.whenStable();
    expect(el.classList).toContain('single');
    expect(texts('gr-alone-page .title')).toEqual(['Files']);
    expect(el.querySelector('gr-alone-page gr-files-page')).not.toBeNull();
    // Already alone, it offers no single page.
    expect(el.querySelector('gr-files-page .single-page')).toBeNull();
    expect(calls).toContainEqual({ command: 'layout.set', request: { focusPage: 'files' } });

    [...el.querySelectorAll<HTMLButtonElement>('gr-alone-page .gr-link')]
      .find((link) => link.textContent!.includes('Two pages'))!
      .click();
    await fixture.whenStable();
    expect(el.classList).not.toContain('focus');
    expect(el.querySelector('gr-right-page gr-files-page')).not.toBeNull();
  });

  it('lists the files the open chat’s agent changed, a tab away from the folder', async () => {
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
    expect(texts('gr-files-page h3')).toEqual(['Not committed yet', 'All its files']);
    expect(texts('gr-files-page .side-tabs button')).toEqual([
      'The folder',
      'Changed in this chapter 2',
    ]);
    expect(el.querySelector('gr-files-page .touched')).toBeNull();

    button('.side-tabs button', 'Changed in this chapter 2').click();
    await fixture.whenStable();
    expect(texts('gr-files-page h3')).toEqual([]);
    expect(texts('gr-files-page .touched .file')).toEqual(['ui/src/ribbon.ts', 'ui/src/seal.ts']);

    button('.touched .file', 'ui/src/ribbon.ts').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'files.open').at(-1)?.request).toEqual({
      cwd: 'C:/work/grimoire',
      path: 'C:\\Users\\me\\git\\grimoire\\ui\\src\\ribbon.ts',
    });
  });
});
