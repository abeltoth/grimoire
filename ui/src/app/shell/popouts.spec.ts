import { TestBed } from '@angular/core/testing';
import type { OpenChat } from '@grimoire/contract';
import { POPOUT } from '../core/popout';
import { fakeBridge, render } from '../../testing/app-harness';

describe('popouts', () => {
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
  const link = (root: ParentNode, label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('.gr-link')].find(
      (b) => b.textContent!.trim() === label,
    );
  const chatTabs = (texts: (selector: string) => string[]) => texts('gr-chat-tab.chat b');
  /** Lets what the window's closing set off finish. */
  const settle = async (fixture: { whenStable(): Promise<unknown> }) => {
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
  };

  it('pops a chat out into a window of its own, and takes it back when that window closes', async () => {
    const { bridge, answers, calls, closePopout } = fakeBridge();
    answers['agents.openChats'] = () => [
      chat('c1', 'Context meter'),
      chat('c2', 'Fix flaky login test'),
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    const { fixture, el, texts } = await render(bridge);

    link(el, 'Pop out')!.click();
    await fixture.whenStable();
    expect(bridge.popOut).toHaveBeenCalledWith('c1');
    // It's out of the book; the chat stays open with the agent.
    expect(chatTabs(texts)).toEqual(['Fix flaky login test']);
    expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
    expect(calls.some((c) => c.command === 'agents.close')).toBe(false);

    closePopout('c1');
    await settle(fixture);
    expect(chatTabs(texts)).toEqual(['Fix flaky login test', 'Context meter']);
    expect(texts('gr-page-header h1')).toEqual(['Context meter']);

    // A popout closed with its chat doesn't bring it back.
    link(el, 'Pop out')!.click();
    await fixture.whenStable();
    answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
    closePopout('c1');
    await settle(fixture);
    expect(chatTabs(texts)).toEqual(['Fix flaky login test']);
  });

  it('opens the book without the chats popped out', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.openChats'] = () => [
      chat('c1', 'Context meter'),
      chat('c2', 'Fix flaky login test'),
    ];
    answers['layout.get'] = () => ({ current: 'c2', popouts: [{ chatId: 'c1' }] });
    const { texts } = await render(bridge);
    expect(chatTabs(texts)).toEqual(['Fix flaky login test']);
    expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
  });

  it('pops out the chat on the right page, but not a blank one', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.openChats'] = () => [
      chat('c1', 'Context meter'),
      chat('c2', 'Fix flaky login test'),
    ];
    answers['layout.get'] = () => ({ current: 'c1', beside: 'c2' });
    const { fixture, el, texts } = await render(bridge);
    link(el.querySelector('gr-chat-page[beside]')!, 'Pop out')!.click();
    await fixture.whenStable();
    expect(bridge.popOut).toHaveBeenCalledWith('c2');
    expect(el.querySelector('gr-chat-page[beside]')).toBeNull();
    expect(texts('gr-second-chat .none')).toEqual(['No other chapter is open.']);

    [...el.querySelectorAll<HTMLButtonElement>('gr-second-chat .gr-link')]
      .find((b) => b.textContent!.trim() === 'A new chapter')!
      .click();
    await fixture.whenStable();
    expect(link(el.querySelector('gr-chat-page[beside]')!, 'Pop out')).toBeUndefined();
  });

  describe('in its own window', () => {
    const popout = (id: string) => [{ provide: POPOUT, useValue: id }];

    it('holds its one chat alone on the desk, and goes back in the book', async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [
        chat('c1', 'Context meter'),
        chat('c2', 'Fix flaky login test'),
      ];
      answers['layout.get'] = () => ({ current: 'c1', focus: true });
      const { fixture, el, texts } = await render(bridge, popout('c2'));
      expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
      for (const part of ['gr-title-bar', 'gr-chat-tabs', 'gr-page-tabs', 'gr-right-page'])
        expect(el.querySelector(part)).toBeNull();
      expect(el.querySelector('gr-window-controls')).not.toBeNull();
      expect(link(el, 'Pop out')).toBeUndefined();
      expect(link(el, 'Two pages')).toBeUndefined();
      expect(el.querySelector('gr-composer button[aria-label^="Parallel texts"]')).toBeNull();
      // It doesn't move the book's place, or listen for popouts.
      expect(calls.filter((c) => c.command === 'layout.set')).toEqual([]);
      expect(bridge.onPopoutClosed).not.toHaveBeenCalled();

      link(el, 'Back in the book')!.click();
      await fixture.whenStable();
      expect(bridge.window.close).toHaveBeenCalled();
    });

    it("lists the agent's commands on its own page, above the message field", async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
      answers['agents.commands'] = () => [
        { name: 'compact', description: 'Free up context', kind: 'command' },
      ];
      const { fixture, el, texts } = await render(bridge, popout('c2'));
      const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
      field.value = '/';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(texts('gr-chat-page gr-slash-commands .entry .label')).toEqual(['/compact']);
      expect(el.querySelector('gr-slash-commands gr-page-footer')).toBeNull();
      expect(el.querySelector('gr-transcript')).toBeNull();
      expect(el.querySelector('#gr-next-message')).toBe(field);
      expect(texts('gr-composer .slash-hint')).toEqual([
        'Claude Code’s commands and skills are listed above ↑',
      ]);

      field.value = '';
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(el.querySelector('gr-slash-commands')).toBeNull();
      expect(el.querySelector('gr-transcript')).not.toBeNull();
    });

    it("closes its window when its chat closes, or isn't open", async () => {
      const { bridge, answers, calls } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
      const { fixture, el } = await render(bridge, popout('c2'));
      link(el, 'Close')!.click();
      await fixture.whenStable();
      expect(calls).toContainEqual({ command: 'agents.close', request: { chatId: 'c2' } });
      expect(bridge.window.close).toHaveBeenCalled();

      TestBed.resetTestingModule();
      const other = fakeBridge();
      other.answers['agents.openChats'] = () => [];
      await render(other.bridge, popout('c2'));
      expect(other.bridge.window.close).toHaveBeenCalled();
    });

    it('pops a fork out as a popout of its own', async () => {
      const { bridge, answers } = fakeBridge();
      answers['agents.openChats'] = () => [chat('c2', 'Fix flaky login test')];
      answers['agents.fork'] = () => chat('c3', 'Fix flaky login test (a)');
      const { fixture, el, texts } = await render(bridge, popout('c2'));
      [...el.querySelectorAll<HTMLButtonElement>('.you .by button')]
        .find((b) => b.textContent!.trim() === 'Fork')!
        .click();
      await fixture.whenStable();
      expect(bridge.popOut).toHaveBeenCalledWith('c3');
      expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
    });
  });
});
