import type {
  CommandRequest,
  FolderEntry,
  GitStatus,
  GrimoireBridge,
  OpenFile,
} from '@grimoire/contract';
import { MONACO, type MonacoApi } from './monaco';
import { fakeBridge, render, write } from '@ui/testing/app-harness';

describe('files', () => {
  describe('the Files page', () => {
    /** The VS Code editor, faked as a text box for each side it shows. */
    function fakeMonaco() {
      const made: { editors: number; diffs: number; themes: string[]; revealed: number } = {
        editors: 0,
        diffs: 0,
        themes: [],
        revealed: 0,
      };
      const modelOf = (text: string, language: string) => {
        const listeners = new Set<() => void>();
        let value = text;
        return {
          language,
          getValue: () => value,
          setValue: (next: string) => {
            value = next;
            listeners.forEach((listener) => listener());
          },
          onDidChangeContent: (listener: () => void) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
          },
          dispose: () => listeners.clear(),
        };
      };
      type Model = ReturnType<typeof modelOf>;
      const box = (host: HTMLElement, model: Model, side: string, commands: Map<number, () => void>) => {
        const area = document.createElement('textarea');
        area.className = `fake-editor ${side}`;
        area.dataset['language'] = model.language;
        area.value = model.getValue();
        area.addEventListener('input', () => model.setValue(area.value));
        area.addEventListener('keydown', (event) => {
          if (event.ctrlKey && event.key === 's') commands.get(2048 | 49)?.();
        });
        const shown = model.onDidChangeContent(() => (area.value = model.getValue()));
        host.append(area);
        return {
          saveViewState: () => ({}),
          restoreViewState: () => undefined,
          addCommand: (keys: number, run: () => void) => void commands.set(keys, run),
          dispose: () => {
            shown.dispose();
            area.remove();
          },
        };
      };
      const monaco = {
        Uri: { from: (parts: unknown) => parts },
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { KeyS: 49 },
        languages: {
          getLanguages: () => [
            { id: 'typescript', extensions: ['.ts'] },
            { id: 'markdown', extensions: ['.md'] },
          ],
        },
        editor: {
          defineTheme: (name: string) => void made.themes.push(name),
          createModel: (text: string, language: string) => modelOf(text, language),
          create: (host: HTMLElement, options: { model: Model }) => {
            made.editors++;
            return box(host, options.model, 'file', new Map());
          },
          createDiffEditor: (host: HTMLElement) => {
            made.diffs++;
            const commands = new Map<number, () => void>();
            let sides: ReturnType<typeof box>[] = [];
            let modified: ReturnType<typeof box> | undefined;
            return {
              setModel: (models: { original: Model; modified: Model }) => {
                const original = box(host, models.original, 'committed', new Map());
                modified = box(host, models.modified, 'file', commands);
                sides = [original, modified];
              },
              getModifiedEditor: () => modified!,
              revealFirstDiff: () => void made.revealed++,
              dispose: () => sides.forEach((side) => side.dispose()),
            };
          },
        },
      };
      return { load: async () => monaco as unknown as MonacoApi, made };
    }

    const entries = (folder: string, names: string[], ignored: string[] = []): FolderEntry[] =>
      names.map((name) => {
        const path = folder ? `${folder}/${name.replace(/\/$/, '')}` : name.replace(/\/$/, '');
        return {
          name: name.replace(/\/$/, ''),
          path,
          kind: name.endsWith('/') ? 'folder' : 'file',
          ...(ignored.includes(name) ? { ignored: true } : {}),
        };
      });

    /** A repository with a few files, one of them changed and one new. */
    function repository() {
      const fake = fakeBridge();
      const { answers } = fake;
      const disk: Record<string, OpenFile> = {
        'README.md': { path: 'README.md', text: '# Grimoire\n', changedAt: 1 },
        'ui/src/ribbon.ts': {
          path: 'ui/src/ribbon.ts',
          text: 'export const ribbon = 2;\n',
          changedAt: 1,
          committed: 'export const ribbon = 1;\n',
        },
        'ui/src/seal.ts': { path: 'ui/src/seal.ts', text: 'export const seal = 1;\n', changedAt: 1, committed: null },
        'logo.png': { path: 'logo.png', text: '', changedAt: 1, unshown: 'binary' },
      };
      answers['files.list'] = (request: CommandRequest<'files.list'>) => ({
        root: 'C:/Users/me/git/grimoire',
        entries:
          request.path === ''
            ? entries('', ['dist/', 'ui/', 'logo.png', 'README.md'], ['dist/'])
            : request.path === 'ui'
              ? entries('ui', ['src/'])
              : request.path === 'ui/src'
                ? entries('ui/src', ['ribbon.ts', 'seal.ts'])
                : [],
      });
      disk['C:/Users/me/.claude/CLAUDE.md'] = {
        path: 'C:/Users/me/.claude/CLAUDE.md',
        text: '# Mine\n',
        changedAt: 1,
      };
      // Written in full inside the folder, a file is named from it, as the service does.
      answers['files.open'] = (request: CommandRequest<'files.open'>) =>
        disk[request.path.replace(/^C:\/(Users\/me\/git|work)\/grimoire\//, '')];
      answers['git.diff'] = () => [
        { kind: 'removed', text: 'export const ribbon = 1;' },
        { kind: 'inserted', text: 'export const ribbon = 2;' },
      ];
      answers['files.save'] = (request: CommandRequest<'files.save'>) =>
        (disk[request.path] = { ...disk[request.path]!, text: request.text, changedAt: 2 });
      answers['files.find'] = (request: CommandRequest<'files.find'>) =>
        Object.keys(disk).filter((path) => path.includes(request.query));
      answers['git.status'] = (): GitStatus => ({
        root: 'C:/Users/me/git/grimoire',
        branch: 'master',
        head: 'abc1234',
        changes: [
          { path: 'ui/src/ribbon.ts', kind: 'modified', staged: false },
          { path: 'ui/src/seal.ts', kind: 'new', staged: false },
          { path: 'old.txt', kind: 'deleted', staged: false },
        ],
      });
      return { ...fake, disk };
    }

    async function openFiles(bridge: GrimoireBridge) {
      const monaco = fakeMonaco();
      const rendered = await render(bridge, [{ provide: MONACO, useValue: monaco.load }]);
      [...rendered.el.querySelectorAll<HTMLButtonElement>('.tabs button')]
        .find((tab) => tab.textContent!.trim() === 'Files')!
        .click();
      await rendered.fixture.whenStable();
      const page = () => rendered.el.querySelector('gr-files-page')!;
      const button = (selector: string, text: string) =>
        [...page().querySelectorAll<HTMLButtonElement>(selector)].find(
          (b) => b.textContent!.replace(/\s+/g, ' ').trim() === text,
        )!;
      const editor = (side = 'file') => page().querySelector<HTMLTextAreaElement>(`.fake-editor.${side}`);
      const type = async (text: string) => {
        const area = editor()!;
        area.value = text;
        area.dispatchEvent(new Event('input'));
        await rendered.fixture.whenStable();
      };
      return { ...rendered, made: monaco.made, page, button, editor, type };
    }

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
        'dist/', 'ui/', 'src/', 'ribbon.ts', 'seal.ts', 'logo.png', 'README.md',
      ]);
      expect(calls.filter((c) => c.command === 'files.list').map((c) => c.request)).toEqual([
        { cwd: 'C:/Users/me', path: '' },
        { cwd: 'C:/Users/me', path: 'ui' },
        { cwd: 'C:/Users/me', path: 'ui/src' },
      ]);

      // Folded back in, and out again without reading it twice.
      button('.entry', 'ui/').click();
      await fixture.whenStable();
      expect(texts('gr-files-page .tree .entry')).toEqual(['dist/', 'ui/', 'logo.png', 'README.md']);
      button('.entry', 'ui/').click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'files.list')).toHaveLength(3);
    });

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
      expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual(['Its changes since the last commit']);
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
      expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual(['All new since the last commit']);
      expect(editor('committed')!.value).toBe('');
    });

    it('reads a file open on the page again when it changes on disk, over changes not saved', async () => {
      const { bridge, emit, disk } = repository();
      const { fixture, texts, button, editor, type } = await openFiles(bridge);
      button('.entry', 'README.md').click();
      await fixture.whenStable();
      await type('# Mine\n');

      disk['README.md'] = { path: 'README.md', text: '# Grimoire, by the agent\n', changedAt: 3 };
      emit('files.changed', { root: 'C:/Users/me/git/grimoire', path: 'README.md' });
      await fixture.whenStable();
      expect(editor()!.value).toBe('# Grimoire, by the agent\n');
      expect(texts('gr-files-page .note')).toEqual(['It changed on disk, and was read again.']);
      expect(button('.gr-link', 'Save Ctrl+S').getAttribute('aria-disabled')).toBe('true');

      // Another folder's file of the same name isn't this one.
      emit('files.changed', { root: 'C:/Users/me/git/other', path: 'README.md' });
      await fixture.whenStable();
      expect(editor()!.value).toBe('# Grimoire, by the agent\n');
    });

    it("won't turn back to the folder with changes not saved, until they're discarded", async () => {
      const { bridge, calls } = repository();
      const { fixture, el, texts, button, type } = await openFiles(bridge);
      button('.entry', 'README.md').click();
      await fixture.whenStable();
      await type('# Mine\n');

      button('.gr-link', 'Back to the files').click();
      await fixture.whenStable();
      expect(texts('gr-files-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);
      expect(el.querySelector('gr-code-editor')).not.toBeNull();

      button('.gr-link', 'Discard changes').click();
      await fixture.whenStable();
      button('.gr-link', 'Back to the files').click();
      await fixture.whenStable();
      expect(el.querySelector('gr-code-editor')).toBeNull();
      expect(texts('gr-files-page h3')).toEqual(['Not committed yet', 'All its files']);
      expect(calls).toContainEqual({ command: 'files.close', request: { cwd: 'C:/Users/me', path: 'README.md' } });
    });

    it('keeps the open file and its changes while the right page shows another', async () => {
      const { bridge } = repository();
      const { fixture, el, button, editor, type } = await openFiles(bridge);
      button('.entry', 'README.md').click();
      await fixture.whenStable();
      await type('# Mine\n');
      const tab = (label: string) =>
        [...el.querySelectorAll<HTMLButtonElement>('.tabs button')].find((t) => t.textContent!.trim() === label)!;
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
      const field = el.querySelector<HTMLInputElement>('#gr-files-look-up')!;
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

    describe('Open in Files', () => {
      const chatTabEdit = {
        kind: 'tool' as const,
        id: 't1',
        tool: 'Edit',
        input: {
          file_path: 'C:/work/grimoire/ui/src/ribbon.ts',
          old_string: 'export const ribbon = 1;',
          new_string: 'export const ribbon = 2;',
        },
        result: { text: 'Updated.', isError: false },
      };
      /** The app with the VS Code editor faked, and the diff view's link. */
      async function withEditor(bridge: GrimoireBridge) {
        const monaco = fakeMonaco();
        const rendered = await render(bridge, [{ provide: MONACO, useValue: monaco.load }]);
        const openIn = (where = '') =>
          [...rendered.el.querySelectorAll<HTMLButtonElement>(`${where} gr-diff-view .gr-link`)].find(
            (b) => b.textContent!.trim() === 'Open in Files',
          );
        const expandable = async (name: string) => {
          rendered.el.querySelector<HTMLButtonElement>('.note.summary')?.click();
          await rendered.fixture.whenStable();
          [...rendered.el.querySelectorAll<HTMLButtonElement>('.note')]
            .find((note) => note.textContent!.includes(name) && !note.classList.contains('summary'))!
            .click();
          await rendered.fixture.whenStable();
        };
        return { ...rendered, made: monaco.made, openIn, expandable };
      }

      it('opens a file the agent edited on its changes, from its diff', async () => {
        const { bridge, emit, calls } = repository();
        const { fixture, el, texts, made, openIn, expandable } = await withEditor(bridge);
        await write(fixture, el, 'Fix the ribbon');
        emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'agent', id: 'a1', blocks: [chatTabEdit] } });
        await fixture.whenStable();
        await expandable('ribbon.ts');

        openIn()!.click();
        await fixture.whenStable();
        expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
        expect(calls.filter((c) => c.command === 'files.open').map((c) => c.request)).toEqual([
          { cwd: 'C:/work/grimoire', path: 'C:/work/grimoire/ui/src/ribbon.ts' },
        ]);
        expect(texts('gr-files-page .sub .path')).toEqual(['ui/src/ribbon.ts']);
        expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual(['Its changes since the last commit']);
        expect(el.querySelector<HTMLTextAreaElement>('gr-files-page .fake-editor.committed')!.value).toBe(
          'export const ribbon = 1;\n',
        );
        // It starts at the first change.
        expect(made.revealed).toBe(1);
      });

      it('opens a change on the Git page in Files', async () => {
        const { bridge, calls } = repository();
        const { fixture, el, texts, openIn } = await withEditor(bridge);
        [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
          .find((tab) => tab.textContent!.trim() === 'Git')!
          .click();
        await fixture.whenStable();
        el.querySelector<HTMLButtonElement>('gr-git-page .change')!.click();
        await fixture.whenStable();

        openIn('gr-git-page')!.click();
        await fixture.whenStable();
        expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
        expect(calls.filter((c) => c.command === 'files.open').map((c) => c.request)).toEqual([
          { cwd: 'C:/Users/me', path: 'C:/Users/me/git/grimoire/ui/src/ribbon.ts' },
        ]);
        expect(texts('gr-files-page .sub .path')).toEqual(['ui/src/ribbon.ts']);
      });

      it('opens a file outside the folder from an edit only proposed, as it is now', async () => {
        const { bridge, emit } = repository();
        const { fixture, el, texts, openIn } = await withEditor(bridge);
        await write(fixture, el, 'Remember this');
        emit('agents.approval', {
          approval: {
            id: 'ap1',
            chatId: 'chat-1',
            tool: 'Edit',
            input: { file_path: 'C:/Users/me/.claude/CLAUDE.md', old_string: '# Mine', new_string: '# Ours' },
            alwaysAllow: { scope: 'chat' },
          },
        });
        await fixture.whenStable();

        openIn('gr-approval-card')!.click();
        await fixture.whenStable();
        expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
        expect(texts('gr-files-page .sub .path')).toEqual(['~/.claude/CLAUDE.md']);
        expect(el.querySelector<HTMLTextAreaElement>('gr-files-page .fake-editor')!.value).toBe('# Mine\n');
        // Not in a repository: nothing to show beside it.
        expect(el.querySelector('gr-files-page .show')).toBeNull();
      });

      it('keeps a file with changes not saved open, and asks to save or discard them first', async () => {
        const { bridge, emit, calls } = repository();
        const { fixture, el, texts, openIn, expandable } = await withEditor(bridge);
        await write(fixture, el, 'Fix the ribbon');
        [...el.querySelectorAll<HTMLButtonElement>('.tabs button')]
          .find((tab) => tab.textContent!.trim() === 'Files')!
          .click();
        await fixture.whenStable();
        [...el.querySelectorAll<HTMLButtonElement>('gr-files-page .entry')]
          .find((entry) => entry.textContent!.trim() === 'README.md')!
          .click();
        await fixture.whenStable();
        const editor = el.querySelector<HTMLTextAreaElement>('gr-files-page .fake-editor')!;
        editor.value = '# Mine\n';
        editor.dispatchEvent(new Event('input'));
        await fixture.whenStable();

        emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'agent', id: 'a1', blocks: [chatTabEdit] } });
        await fixture.whenStable();
        await expandable('ribbon.ts');
        openIn()!.click();
        await fixture.whenStable();
        expect(texts('gr-files-page .sub .path')).toEqual(['README.md']);
        expect(texts('gr-files-page .note.alert')).toEqual(['Save your changes, or discard them, first.']);
        expect(calls.filter((c) => c.command === 'files.open')).toHaveLength(1);
      });

      it('leaves Open in Files out in focus mode, where there is no right page', async () => {
        const { bridge, emit } = repository();
        const { fixture, el, openIn, expandable } = await withEditor(bridge);
        await write(fixture, el, 'Fix the ribbon');
        emit('agents.entry', { chatId: 'chat-1', entry: { kind: 'agent', id: 'a1', blocks: [chatTabEdit] } });
        await fixture.whenStable();
        await expandable('ribbon.ts');
        expect(openIn()).toBeDefined();

        [...el.querySelectorAll<HTMLButtonElement>('gr-right-page .gr-link')]
          .find((link) => link.textContent!.includes('Single page'))!
          .click();
        await fixture.whenStable();
        expect(el.querySelector('gr-diff-view')).not.toBeNull();
        expect(openIn()).toBeUndefined();
      });
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
});
