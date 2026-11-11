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
      emit('agents.entry', {
        chatId: 'chat-1',
        entry: { kind: 'agent', id: 'a1', blocks: [chatTabEdit] },
      });
      await fixture.whenStable();
      await expandable('ribbon.ts');

      openIn()!.click();
      await fixture.whenStable();
      expect(texts('.tabs [aria-pressed="true"]')).toEqual(['Files']);
      expect(calls.filter((c) => c.command === 'files.open').map((c) => c.request)).toEqual([
        { cwd: 'C:/work/grimoire', path: 'C:/work/grimoire/ui/src/ribbon.ts' },
      ]);
      expect(texts('gr-files-page .sub .path')).toEqual(['ui/src/ribbon.ts']);
      expect(texts('gr-files-page .show [aria-checked="true"]')).toEqual([
        'Its changes since the last commit',
      ]);
      expect(
        el.querySelector<HTMLTextAreaElement>('gr-files-page .fake-editor.committed')!.value,
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
      expect(texts('gr-files-page .sub .path')).toEqual(['~/.claude/CLAUDE.md']);
      expect(el.querySelector<HTMLTextAreaElement>('gr-files-page .fake-editor')!.value).toBe(
        '# Mine\n',
      );
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

      emit('agents.entry', {
        chatId: 'chat-1',
        entry: { kind: 'agent', id: 'a1', blocks: [chatTabEdit] },
      });
      await fixture.whenStable();
      await expandable('ribbon.ts');
      openIn()!.click();
      await fixture.whenStable();
      expect(texts('gr-files-page .sub .path')).toEqual(['README.md']);
      expect(texts('gr-files-page .note.alert')).toEqual([
        'Save your changes, or discard them, first.',
      ]);
      expect(calls.filter((c) => c.command === 'files.open')).toHaveLength(1);
    });

    it('leaves Open in Files out in focus mode, where there is no right page', async () => {
      const { bridge, emit } = repository();
      const { fixture, el, openIn, expandable } = await withEditor(bridge);
      await write(fixture, el, 'Fix the ribbon');
      emit('agents.entry', {
        chatId: 'chat-1',
        entry: { kind: 'agent', id: 'a1', blocks: [chatTabEdit] },
      });
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
});
