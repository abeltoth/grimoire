import type { CommandRequest, OpenChat } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('second-chat', () => {
  describe('a second chat on the right page', () => {
    const chat = (id: string, title: string): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: `C:/work/${id}` },
      status: 'idle',
      entries: [{ kind: 'user', id: `u-${id}`, text: `Hello ${title}` }],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
    });
    const tab = (el: HTMLElement, label: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-right-page-tabs .tabs button')].find(
        (b) => b.textContent!.trim() === label,
      )!;
    const beside = (el: HTMLElement) => el.querySelector<HTMLElement>('gr-chat-page[beside]');
    const layouts = (calls: { command: string; request: unknown }[]) =>
      calls
        .filter((c) => c.command === 'layout.set')
        .map((c) => c.request as Record<string, unknown>);

    it('puts another open chat there, to work in as on the left page', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [
        chat('c1', 'Context meter'),
        chat('c2', 'Fix flaky login test'),
      ];
      answers['layout.get'] = () => ({ current: 'c1' });
      const { fixture, el, texts } = await render(bridge);

      tab(el, 'Second chapter').click();
      await fixture.whenStable();
      expect(texts('gr-second-chat .ask')).toEqual([
        'Which chapter goes on this page, beside the one you’re on?',
      ]);
      expect(texts('gr-second-chat .pick')).toEqual(['Fix flaky login test']);
      expect(texts('gr-second-chat .meta')).toEqual(['Claude Code · C:/work/c2']);

      el.querySelector<HTMLButtonElement>('gr-second-chat .pick')!.click();
      await fixture.whenStable();
      expect(layouts(calls)).toContainEqual({ beside: 'c2' });
      // Both pages are chats: the left one stays, the other heads the right page with its title.
      expect(texts('gr-page-header h1')).toEqual(['Context meter']);
      expect(texts('gr-right-page-tabs .tabs [aria-pressed="true"]')).toEqual([
        'Fix flaky login test',
      ]);
      expect(beside(el)!.querySelector('.meta')!.textContent).toContain('C:/work/c2');
      expect(texts('gr-chat-tab.beside b')).toEqual(['Fix flaky login test']);
      expect(texts('gr-chat-tab.beside i')).toEqual(['Claude Code · idle · on the facing page']);

      // Its message goes to its own chat.
      const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message-beside')!;
      field.value = 'Run the tests again';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      beside(el)!.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
      await fixture.whenStable();
      expect(calls).toContainEqual({
        command: 'agents.send',
        request: { chatId: 'c2', text: 'Run the tests again' },
      });

      // Its settings open on it, without turning the left page.
      beside(el)!.querySelector<HTMLButtonElement>('.meta button')!.click();
      await fixture.whenStable();
      expect(beside(el)!.querySelector('gr-settings-card')).not.toBeNull();
      expect(texts('gr-page-header h1')).toEqual(['Context meter']);
      // Esc there closes them, and leaves the left page alone.
      beside(el)!
        .querySelector('.meta button')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        );
      await fixture.whenStable();
      expect(el.querySelector('gr-settings-card')).toBeNull();

      // Its chat tab swaps the two pages.
      el.querySelector<HTMLButtonElement>('gr-chat-tab.beside .tail')!.click();
      await fixture.whenStable();
      expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
      expect(texts('gr-right-page-tabs .tabs [aria-pressed="true"]')).toEqual(['Context meter']);
      expect(layouts(calls).slice(-2)).toEqual([{ beside: 'c1' }, { current: 'c2' }]);

      // Another chat takes it off the page; it stays open.
      [...beside(el)!.querySelectorAll<HTMLButtonElement>('.gr-link')]
        .find((b) => b.textContent!.trim() === 'Another chapter')!
        .click();
      await fixture.whenStable();
      expect(beside(el)).toBeNull();
      expect(texts('gr-second-chat .pick')).toEqual(['Context meter']);
      expect(layouts(calls).at(-1)).toEqual({ beside: null });
      expect(texts('gr-chat-tab.chat b')).toEqual(['Context meter', 'Fix flaky login test']);
    });

    it('opens a new chat there, and keeps it there once it begins', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
      answers['layout.get'] = () => ({ current: 'c1' });
      answers['agents.start'] = () => chat('c9', '');
      const { fixture, el, texts } = await render(bridge);
      tab(el, 'Second chapter').click();
      await fixture.whenStable();
      expect(texts('gr-second-chat .none')).toEqual(['No other chapter is open.']);

      [...el.querySelectorAll<HTMLButtonElement>('gr-second-chat .gr-link')]
        .find((b) => b.textContent!.trim() === 'A new chapter')!
        .click();
      await fixture.whenStable();
      expect(beside(el)!.querySelector('gr-chat-intro')).not.toBeNull();
      expect(texts('gr-page-header h1')).toEqual(['Context meter']);

      const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message-beside')!;
      field.value = 'Write the ribbon tests';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      beside(el)!.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'agents.start')).toHaveLength(1);
      expect(layouts(calls)).toContainEqual({ beside: 'c9' });
      expect(beside(el)!.querySelector('gr-transcript')).not.toBeNull();
      expect(texts('gr-page-header h1')).toEqual(['Context meter']);
    });

    it('opens the book with the chat that was beside the one you were on', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [
        chat('c1', 'Context meter'),
        chat('c2', 'Fix flaky login test'),
      ];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      const { el, texts } = await render(bridge);
      expect(texts('gr-page-header h1')).toEqual(['Context meter']);
      expect(texts('gr-right-page-tabs .tabs [aria-pressed="true"]')).toEqual([
        'Fix flaky login test',
      ]);
      expect(beside(el)).not.toBeNull();
    });

    it("lists the agent's commands for its message on the left page", async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [
        chat('c1', 'Context meter'),
        chat('c2', 'Fix flaky login test'),
      ];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      answers['agents.commands'] = () => [
        { name: 'compact', description: 'Free up context', kind: 'command' },
      ];
      const { fixture, el, texts } = await render(bridge);
      const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message-beside')!;
      field.value = '/';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(el.querySelector('gr-page:not(.right-page) gr-slash-commands')).not.toBeNull();
      expect(el.querySelector('gr-page.right-page gr-slash-commands')).toBeNull();
      expect(el.querySelector('#gr-next-message-beside')).toBe(field);
      expect(texts('gr-slash-commands .entry .label')).toEqual(['/compact']);
      expect(texts('gr-composer .slash-hint')).toEqual([
        'Claude Code’s commands and skills are on the facing page ←',
      ]);
      expect(texts('gr-slash-commands .gr-link')[0]).toMatch(/^Back to the chapter/);

      field.value = '';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(el.querySelector('gr-slash-commands')).toBeNull();
      expect(texts('gr-page-header h1')).toEqual(['Context meter']);
    });

    it('forgets the chat beside once it closes', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [
        chat('c1', 'Context meter'),
        chat('c2', 'Fix flaky login test'),
      ];
      answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
      const { fixture, el, texts } = await render(bridge);
      [...beside(el)!.querySelectorAll<HTMLButtonElement>('.gr-link')]
        .find((b) => b.textContent!.trim() === 'Close')!
        .click();
      await fixture.whenStable();
      expect(beside(el)).toBeNull();
      expect(texts('gr-second-chat .none')).toEqual(['No other chapter is open.']);
      expect(layouts(calls).at(-1)).toEqual({ beside: null });
      expect(texts('gr-page-header h1')).toEqual(['Context meter']);
    });

    describe('parallel chats', () => {
      const parallel = (el: HTMLElement) =>
        el.querySelector<HTMLButtonElement>('gr-composer button[aria-label^="Parallel texts"]');
      const write = async (
        el: HTMLElement,
        fixture: { whenStable(): Promise<unknown> },
        text: string,
      ) => {
        const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
        field.value = text;
        field.dispatchEvent(new Event('input'));
        await fixture.whenStable();
      };
      const forking = () => [{ id: 'claude-code', name: 'Claude Code', capabilities: ['fork'] }];

      it('sends the message to a copy of the chat on a second model, beside it', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.list'] = forking;
        answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
        answers['layout.get'] = () => ({ current: 'c1', focus: true });
        answers['agents.parallel'] = (request: CommandRequest<'agents.parallel'>): OpenChat => ({
          ...chat('c2', 'Context meter (a)'),
          settings: { cwd: 'C:/work/c1', model: request.model },
          status: 'thinking',
          readOnly: { chatId: 'c1', title: 'Context meter' },
        });
        const { fixture, el, texts } = await render(bridge);
        expect(parallel(el)!.getAttribute('aria-pressed')).toBe('false');

        parallel(el)!.click();
        await fixture.whenStable();
        expect(parallel(el)!.getAttribute('aria-pressed')).toBe('true');
        // The chat is on Opus, the default: the others are offered, the first picked.
        expect(texts('gr-composer .parallel-model')).toEqual(['Sonnet 5.5', 'Haiku 5.5']);
        expect(texts('gr-composer .parallel-model[aria-checked="true"]')).toEqual(['Sonnet 5.5']);
        expect(texts('gr-composer .parallel-where')).toEqual([
          'a copy of this chapter, on the facing page',
        ]);
        el.querySelectorAll<HTMLButtonElement>('gr-composer .parallel-model')[1]!.click();
        await fixture.whenStable();
        expect(texts('gr-composer .parallel-model[aria-checked="true"]')).toEqual(['Haiku 5.5']);

        await write(el, fixture, 'Colour it');
        el.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
        await fixture.whenStable();
        // The service sends it to both: the chat, and its copy.
        expect(calls).toContainEqual({
          command: 'agents.parallel',
          request: { from: { chatId: 'c1' }, model: 'haiku', text: 'Colour it' },
        });
        expect(calls.some((c) => c.command === 'agents.send')).toBe(false);
        // Out of focus, so the copy shows on the right page.
        expect(layouts(calls)).toContainEqual({ focus: false });
        expect(layouts(calls)).toContainEqual({ beside: 'c2' });
        expect(texts('gr-page-header h1')).toEqual(['Context meter']);
        expect(texts('gr-right-page-tabs .tabs [aria-pressed="true"]')).toEqual([
          'Context meter (a)',
        ]);
        expect(beside(el)!.querySelector('gr-transcript')).not.toBeNull();
        // It works in the same folder, so it only reads while the chat edits.
        expect(beside(el)!.querySelector('.read-only p')!.textContent!.trim()).toBe(
          'Read-only — “Context meter” is editing',
        );
        // Parallel is off again, and not offered on the right page.
        expect(el.querySelector('gr-composer .parallel')).toBeNull();
        expect(parallel(el)!.getAttribute('aria-pressed')).toBe('false');
        expect(beside(el)!.querySelector('button[aria-label^="Parallel texts"]')).toBeNull();
      });

      it('starts a blank chat first, then the second afresh', async () => {
        const { bridge, answers, calls } = fakeBridge();
        answers['agents.parallel'] = (): OpenChat => ({ ...chat('c9', ''), status: 'thinking' });
        const { fixture, el, texts } = await render(bridge);
        parallel(el)!.click();
        await fixture.whenStable();
        expect(texts('gr-composer .parallel-where')).toEqual([
          'a chapter of its own, on the facing page',
        ]);

        await write(el, fixture, 'Fix the login test');
        el.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
        await fixture.whenStable();
        const started = calls.findIndex((c) => c.command === 'agents.start');
        const second = calls.findIndex((c) => c.command === 'agents.parallel');
        expect(started).toBeGreaterThan(-1);
        expect(second).toBeGreaterThan(started);
        expect(calls[second]!.request).toMatchObject({
          from: { agent: 'claude-code', alongside: 'chat-1' },
          model: 'sonnet',
          text: 'Fix the login test',
        });
        expect(layouts(calls)).toContainEqual({ beside: 'c9' });
        expect(el.querySelectorAll('gr-chat-tab.chat')).toHaveLength(2);
        expect(el.querySelectorAll('gr-chat-tab.beside')).toHaveLength(1);
        expect(beside(el)!.querySelector('gr-transcript')).not.toBeNull();
      });

      it('waits for the turn to end to copy a chat', async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.list'] = forking;
        answers['agents.openChats'] = () => [
          { ...chat('c1', 'Context meter'), status: 'thinking' },
        ];
        answers['layout.get'] = () => ({ current: 'c1' });
        const { fixture, el } = await render(bridge);
        expect(parallel(el)!.getAttribute('aria-disabled')).toBe('true');
        parallel(el)!.click();
        await fixture.whenStable();
        expect(el.querySelector('gr-composer .parallel')).toBeNull();
      });

      it("shows on the chat why the copy couldn't be made", async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.list'] = forking;
        answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
        answers['layout.get'] = () => ({ current: 'c1' });
        answers['agents.parallel'] = () =>
          Promise.reject(new Error('Claude Code can’t copy a chat to another model'));
        const { fixture, el, texts } = await render(bridge);
        parallel(el)!.click();
        await fixture.whenStable();
        await write(el, fixture, 'Colour it');
        el.querySelector<HTMLButtonElement>('gr-composer .send')!.click();
        await fixture.whenStable();
        expect(texts('.error')).toEqual(['Claude Code can’t copy a chat to another model']);
        expect(beside(el)).toBeNull();
      });

      it("isn't offered when the agent can't copy a chat that has begun", async () => {
        const { bridge, answers } = fakeBridge();
        answers['agents.openChats'] = () => [chat('c1', 'Context meter')];
        answers['layout.get'] = () => ({ current: 'c1' });
        const { el } = await render(bridge);
        expect(parallel(el)).toBeNull();
      });
    });
  });
});
