import type { GrimoireBridge } from '@grimoire/contract';
import { MONACO } from './monaco';
import { render, write } from '@ui/testing/app-testing';
import { fakeMonaco, repository } from './files-testing';

describe('files.providers', () => {
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
      return { ...rendered, made: monaco.made, openIn };
    }

    it('opens a file the agent edited on its changes, from its diff', async () => {
      const { bridge, emit, calls } = repository();
      const { fixture, el, texts, made, openIn } = await withEditor(bridge);
      await write(fixture, el, 'Fix the ribbon');
      emit('agents.entry', {
        chatId: 'chat-1',
        entry: { kind: 'agent', id: 'a1', blocks: [chatTabEdit] },
      });
      await fixture.whenStable();

      openIn()!.click();
      await fixture.whenStable();
      expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
      expect(calls.filter((c) => c.command === 'files.open').map((c) => c.request)).toEqual([
        { cwd: 'C:/work/grimoire', path: 'C:/work/grimoire/ui/src/ribbon.ts' },
      ]);
      expect(texts('gr-files-page .opened-file:not(.hidden) .sub .path')).toEqual([
        'ui/src/ribbon.ts',
      ]);
      expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual([
        'Its changes since the last commit',
      ]);
      expect(
        el.querySelector<HTMLTextAreaElement>(
          'gr-files-page .opened-file:not(.hidden) .fake-editor.committed',
        )!.value,
      ).toBe('export const ribbon = 1;\n');
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
      el.querySelector<HTMLButtonElement>('gr-git-graph .changes .open')!.click();
      await fixture.whenStable();
      el.querySelector<HTMLButtonElement>('gr-git-page .change')!.click();
      await fixture.whenStable();

      openIn('gr-git-page')!.click();
      await fixture.whenStable();
      expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
      expect(calls.filter((c) => c.command === 'files.open').map((c) => c.request)).toEqual([
        { cwd: 'C:/Users/me', path: 'C:/Users/me/git/grimoire/ui/src/ribbon.ts' },
      ]);
      expect(texts('gr-files-page .opened-file:not(.hidden) .sub .path')).toEqual([
        'ui/src/ribbon.ts',
      ]);
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
          input: {
            file_path: 'C:/Users/me/.claude/CLAUDE.md',
            old_string: '# Mine',
            new_string: '# Ours',
          },
          alwaysAllow: { scope: 'chat' },
        },
      });
      await fixture.whenStable();

      openIn('gr-approval-card')!.click();
      await fixture.whenStable();
      expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
      expect(texts('gr-files-page .opened-file:not(.hidden) .sub .path')).toEqual([
        '~/.claude/CLAUDE.md',
      ]);
      expect(el.querySelector<HTMLTextAreaElement>('gr-files-page .fake-editor')!.value).toBe(
        '# Mine\n',
      );
      // Not in a repository: nothing to show beside it.
      expect(el.querySelector('gr-files-page .show')).toBeNull();
    });

    it('opens beside a file with changes not saved, which keeps them', async () => {
      const { bridge, emit, calls } = repository();
      const { fixture, el, texts, openIn } = await withEditor(bridge);
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

      emit('agents.entry', {
        chatId: 'chat-1',
        entry: { kind: 'agent', id: 'a1', blocks: [chatTabEdit] },
      });
      await fixture.whenStable();
      openIn()!.click();
      await fixture.whenStable();
      expect(texts('gr-files-page .file-tab')).toEqual(['README.md ●', 'ribbon.ts']);
      expect(texts('gr-files-page .opened-file:not(.hidden) .sub .path')).toEqual([
        'ui/src/ribbon.ts',
      ]);
      expect(calls.filter((c) => c.command === 'files.open')).toHaveLength(2);
      // README.md keeps its changes behind its tab.
      expect(
        el.querySelector<HTMLTextAreaElement>('gr-files-page .opened-file.hidden .fake-editor')!
          .value,
      ).toBe('# Mine\n');
    });

    it('opens a file a reply names, at its line, from a link or from code', async () => {
      const { bridge, emit, calls } = repository();
      const { fixture, el, texts, made } = await withEditor(bridge);
      await write(fixture, el, 'Where is the ribbon?');
      emit('agents.entry', {
        chatId: 'chat-1',
        entry: {
          kind: 'agent',
          id: 'a1',
          blocks: [
            {
              kind: 'text',
              text: 'It’s in `ui/src/ribbon.ts:1`, and [the seal](ui/src/seal.ts#L1) beside it; `npm test` checks both.',
            },
          ],
        },
      });
      await fixture.whenStable();
      expect(texts('gr-markdown a.file')).toEqual(['ui/src/ribbon.ts:1']);

      el.querySelector<HTMLAnchorElement>('gr-markdown a.file')!.click();
      await fixture.whenStable();
      expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
      expect(calls.filter((c) => c.command === 'files.open').map((c) => c.request)).toEqual([
        { cwd: 'C:/work/grimoire', path: 'C:/work/grimoire/ui/src/ribbon.ts' },
      ]);
      // At a line, it shows the file rather than its changes.
      expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual(['The file']);
      expect(made.lines).toEqual([1]);

      [...el.querySelectorAll<HTMLAnchorElement>('gr-markdown a')]
        .find((link) => link.textContent!.trim() === 'the seal')!
        .click();
      await fixture.whenStable();
      expect(texts('gr-files-page .file-tab')).toEqual(['ribbon.ts', 'seal.ts']);
      expect(made.lines).toEqual([1, 1]);
    });

    it('opens a file in focus mode on the Files page, alone in the chat’s place', async () => {
      const { bridge, emit, calls } = repository();
      const { fixture, el, texts, openIn } = await withEditor(bridge);
      await write(fixture, el, 'Fix the ribbon');
      emit('agents.entry', {
        chatId: 'chat-1',
        entry: { kind: 'agent', id: 'a1', blocks: [chatTabEdit] },
      });
      await fixture.whenStable();
      singlePage(el);
      await fixture.whenStable();

      openIn()!.click();
      await fixture.whenStable();
      expect(el.classList).toContain('single');
      expect(el.querySelector('gr-right-page')).toBeNull();
      expect(texts('gr-alone-page .title')).toEqual(['Files']);
      expect(texts('gr-files-page .opened-file:not(.hidden) .sub .path')).toEqual([
        'ui/src/ribbon.ts',
      ]);
      expect(calls).toContainEqual({ command: 'layout.set', request: { focusPage: 'files' } });

      [...el.querySelectorAll<HTMLButtonElement>('gr-alone-page .gr-link')]
        .find((link) => link.textContent!.includes('Back to the chapter'))!
        .click();
      await fixture.whenStable();
      expect(el.querySelector('gr-alone-page')).toBeNull();
      expect(el.querySelector('gr-diff-view')).not.toBeNull();
    });
  });

  describe('the Files shortcut', () => {
    const press = () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true }),
      );

    it('turns the right page to Files', async () => {
      const { bridge } = repository();
      const { fixture, texts } = await render(bridge, [
        { provide: MONACO, useValue: fakeMonaco().load },
      ]);
      press();
      await fixture.whenStable();
      expect(texts('gr-right-page .tabs [aria-pressed="true"]')).toEqual(['Files']);
    });

    it('in focus mode, turns between the chat and Files alone, and the book remembers which', async () => {
      const { bridge, answers } = repository();
      answers['layout.get'] = () => ({
        current: null,
        lastUsed: null,
        focus: true,
        focusPage: 'files',
      });
      const { fixture, el } = await render(bridge, [
        { provide: MONACO, useValue: fakeMonaco().load },
      ]);
      await fixture.whenStable();
      expect(el.querySelector('gr-alone-page gr-files-page')).not.toBeNull();

      press();
      await fixture.whenStable();
      expect(el.querySelector('gr-alone-page')).toBeNull();
      press();
      await fixture.whenStable();
      expect(el.querySelector('gr-alone-page gr-files-page')).not.toBeNull();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      await fixture.whenStable();
      expect(el.querySelector('gr-alone-page')).toBeNull();
    });
  });
});

/** Lays the book at a single page, from the chat's page header. */
function singlePage(el: HTMLElement): void {
  [...el.querySelectorAll<HTMLButtonElement>('gr-page-header .gr-link')]
    .find((link) => link.textContent!.includes('Single page'))!
    .click();
}
