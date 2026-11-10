import { repository, openFiles } from './files-testing';

describe('code-editor', () => {
  it('opens a file in the VS Code editor, and saves what you change with Save or Ctrl+S', async () => {
    const { bridge, calls } = repository();
    const { fixture, el, texts, made, button, editor, type } = await openFiles(bridge);
    button('.entry', 'README.md').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .sub .path')).toEqual(['README.md']);
    expect(editor()!.value).toBe('# Grimoire\n');
    expect(editor()!.dataset['language']).toBe('markdown');
    expect(made).toEqual({ editors: 1, diffs: 0, themes: ['grimoire'], revealed: 0 });
    // Not changed since the last commit: nothing to show beside it.
    expect(el.querySelector('gr-files-page .show')).toBeNull();
    expect(button('.gr-link', 'Save Ctrl+S').getAttribute('aria-disabled')).toBe('true');

    await type('# Grimoire\n\nA book.\n');
    expect(button('.gr-link', 'Save Ctrl+S').getAttribute('aria-disabled')).toBeNull();
    button('.gr-link', 'Save Ctrl+S').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'files.save').map((c) => c.request)).toEqual([
      { cwd: 'C:/Users/me', path: 'README.md', text: '# Grimoire\n\nA book.\n', changedAt: 1 },
    ]);
    expect(texts('gr-files-page .note')).toEqual(['Saved.']);
    expect(button('.gr-link', 'Save Ctrl+S').getAttribute('aria-disabled')).toBe('true');

    await type('# Grimoire\n');
    editor()!.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'files.save').map((c) => c.request)).toContainEqual({
      cwd: 'C:/Users/me',
      path: 'README.md',
      text: '# Grimoire\n',
      changedAt: 2,
    });
  });

  it('opens a changed file beside the file as last committed, and shows the file alone if you like', async () => {
    const { bridge } = repository();
    const { fixture, texts, made, button, editor } = await openFiles(bridge);
    button('.list .file', 'ui/src/ribbon.ts modified').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual([
      'Its changes since the last commit',
    ]);
    expect(editor('committed')!.value).toBe('export const ribbon = 1;\n');
    expect(editor()!.value).toBe('export const ribbon = 2;\n');
    expect(editor()!.dataset['language']).toBe('typescript');

    button('.show button', 'The file').click();
    await fixture.whenStable();
    expect(editor('committed')).toBeNull();
    expect(editor()!.value).toBe('export const ribbon = 2;\n');
    expect(made).toMatchObject({ editors: 1, diffs: 1 });
  });

  it('says a new file is all new since the last commit', async () => {
    const { bridge } = repository();
    const { fixture, texts, button, editor } = await openFiles(bridge);
    button('.list .file', 'ui/src/seal.ts new').click();
    await fixture.whenStable();
    expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual([
      'All new since the last commit',
    ]);
    expect(editor('committed')!.value).toBe('');
  });
});
