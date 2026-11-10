import type { OpenChat } from '@grimoire/contract';
import { fakeBridge, render } from '../../testing/app-harness';

describe('focus', () => {
  it('lays the chat alone on the desk at Single page, and brings everything back at Two pages', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el } = await render(bridge);

    const shown = (selector: string) => el.querySelector(selector) !== null;

    [...el.querySelectorAll<HTMLButtonElement>('gr-right-page .gr-link')]
      .find((link) => link.textContent!.includes('Single page'))!
      .click();
    await fixture.whenStable();
    expect(el.classList).toContain('focus');
    expect(el.classList).toContain('single');
    expect(shown('gr-title-bar')).toBe(false);
    expect(shown('gr-page-tabs')).toBe(false);
    expect(shown('gr-chat-tabs')).toBe(false);
    expect(shown('gr-right-page')).toBe(false);
    expect(shown('.desk.end gr-window-controls [aria-label="Close window"]')).toBe(true);
    expect(calls).toContainEqual({ command: 'layout.set', request: { focus: true } });

    // The Command palette comes back beside the chat, and goes again with it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(el.classList).not.toContain('single');
    expect(shown('gr-right-page gr-command-palette')).toBe(true);
    expect(shown('gr-page-tabs')).toBe(false);
    const labels = [...el.querySelectorAll('gr-command-palette .entry .label')].map((n) =>
      n.textContent!.trim(),
    );
    expect(labels).toContain('Two pages');
    expect(labels).not.toContain('Single page');
    expect(el.querySelector('gr-command-palette .gr-link')!.textContent).toContain(
      'Back to the single page',
    );
    expect(el.querySelector('gr-command-palette .hint')!.textContent).not.toContain('thumb notch');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();
    expect(el.classList).toContain('single');
    expect(shown('gr-right-page')).toBe(false);

    [...el.querySelectorAll<HTMLButtonElement>('gr-page-header .gr-link')]
      .find((link) => link.textContent!.includes('Two pages'))!
      .click();
    await fixture.whenStable();
    expect(el.classList).not.toContain('focus');
    expect(shown('gr-title-bar')).toBe(true);
    expect(shown('gr-page-tabs')).toBe(true);
    expect(shown('gr-chat-tabs')).toBe(true);
    expect(shown('gr-right-page')).toBe(true);
    expect(shown('.desk')).toBe(false);
    expect(calls).toContainEqual({ command: 'layout.set', request: { focus: false } });
  });

  it('opens at a single page when the book was left that way', async () => {
    const { bridge, answers } = fakeBridge();
    answers['layout.get'] = () => ({ current: null, lastUsed: null, focus: true });
    const { fixture, el } = await render(bridge);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(el.classList).toContain('focus');
    expect(el.querySelector('gr-title-bar')).toBeNull();
    expect(el.querySelector('gr-right-page')).toBeNull();
  });

  it('notes in the page footer, in focus, the other chats waiting for you', async () => {
    const { bridge, answers, emit } = fakeBridge();
    const chat = (id: string, title: string, approvals: OpenChat['approvals']): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/work/grimoire' },
      status: approvals.length ? 'waiting' : 'idle',
      entries: [],
      approvals,
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
    });
    const question = {
      question: 'Where should the meter appear?',
      options: [{ label: 'In the composer' }, { label: 'In the running head' }],
      multiSelect: false,
    };
    answers['agents.openChats'] = () => [
      chat('c1', 'Fix flaky login test', [
        { id: 's1', chatId: 'c1', tool: 'Bash', input: { command: 'npm test' }, at: 1 },
        { id: 's2', chatId: 'c1', tool: 'Bash', input: { command: 'git push' }, at: 2 },
      ]),
      chat('c2', 'Context meter', [
        {
          id: 'q1',
          chatId: 'c2',
          tool: 'AskUserQuestion',
          input: {},
          questions: [question],
          at: 3,
        },
      ]),
      chat('c3', 'New onboarding flow', [
        { id: 's3', chatId: 'c3', tool: 'Bash', input: { command: 'npm run build' }, at: 4 },
      ]),
    ];
    answers['layout.get'] = () => ({ current: 'c3', lastUsed: null, focus: true });
    const { fixture, el, texts } = await render(bridge);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    const notes = () => texts('gr-status-indicators .alert');
    const note = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-status-indicators .alert')].find((b) =>
        b.textContent!.includes(text),
      )!;

    // The chat on the desk shows its own approval card on its page.
    expect(notes()).toEqual(['2 approvals awaiting your seal', 'Questions from Context meter']);
    expect(note('awaiting your seal').getAttribute('title')).toBe('From Fix flaky login test');

    note('awaiting your seal').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-right-page')).not.toBeNull();
    expect(el.classList).toContain('focus');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await fixture.whenStable();

    note('Questions from').click();
    await fixture.whenStable();
    expect(texts('gr-page-header h1')).toEqual(['Context meter']);
    expect(el.classList).toContain('focus');
    expect(notes()).toEqual(['3 approvals awaiting your seal']);
    expect(note('awaiting').getAttribute('title')).toBe(
      'From Fix flaky login test and New onboarding flow',
    );

    // Answered elsewhere, the note goes.
    emit('agents.approvalSettled', { chatId: 'c1', approvalId: 's1' });
    emit('agents.approvalSettled', { chatId: 'c1', approvalId: 's2' });
    emit('agents.approvalSettled', { chatId: 'c3', approvalId: 's3' });
    await fixture.whenStable();
    expect(notes()).toEqual([]);
  });
});
