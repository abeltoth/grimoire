import type { OpenChat } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('approvals-page', () => {
  it('turns the right page to every waiting approval, oldest first', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    const chat = (id: string, title: string, command: string, at: number): OpenChat => ({
      id,
      agent: 'claude-code',
      title,
      settings: { cwd: 'C:/Users/me/git/grimoire' },
      status: 'waiting',
      entries: [],
      approvals: [{ id: `${id}-seal`, chatId: id, tool: 'Bash', input: { command }, at }],
      queued: [],
      plan: [],
      withdrawn: [],
      pins: [],

      tags: [],
      copied: [],
    });
    answers['agents.openChats'] = () => [
      chat('c1', 'Fix flaky login test', 'npm test', 200),
      chat('c2', 'Context meter', 'git push', 100),
    ];
    answers['layout.get'] = () => ({ current: 'c2', lastUsed: null });
    const { fixture, el, texts } = await render(bridge);
    const chatTab = [...el.querySelectorAll<HTMLButtonElement>('gr-chat-tab button')].find((b) =>
      b.textContent!.includes('Awaiting your seal'),
    )!;
    const focusedApprovalCard = () => document.activeElement?.closest('gr-approval-card')?.querySelector('.well')?.textContent;

    chatTab.click();
    await fixture.whenStable();
    expect(chatTab.getAttribute('aria-expanded')).toBe('true');
    expect(texts('gr-approvals-page .hint')).toEqual(['2 slips from 2 chapters, oldest first']);
    expect(texts('gr-approvals-page .gr-link')[0]).toBe('Back to the Outline Esc');
    expect(texts('gr-approvals-page gr-approval-card .head b')).toEqual([
      'Context meter',
      'Fix flaky login test',
    ]);
    expect(texts('gr-approvals-page gr-approval-card .meta span')[0]).toBe('Runs in ~/git/grimoire');
    // In its chat, the approval card is a stub pointing to the right page.
    expect(texts('gr-chat-page gr-approval-stub code')).toEqual(['git push']);
    expect(focusedApprovalCard()).toBe('$git push');
    el.querySelector('gr-approvals-page gr-approval-card')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(focusedApprovalCard()).toBe('$npm test');

    // Esc turns back, denying nothing.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(el.querySelector('gr-approvals-page')).toBeNull();
    expect(texts('gr-chat-page gr-approval-card .well')).toEqual(['$git push']);
    expect(calls.some((c) => c.command === 'agents.decide')).toBe(false);

    // The stub opens the page on its own approval card; approving answers in that chat.
    chatTab.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('gr-approval-stub button')!.click();
    await fixture.whenStable();
    expect(focusedApprovalCard()).toBe('$git push');
    el.querySelectorAll<HTMLButtonElement>('gr-approvals-page .approve-button')[1]!.click();
    expect(calls.find((c) => c.command === 'agents.decide')?.request).toEqual({
      approvalId: 'c1-seal',
      decision: 'allow-once',
    });
    emit('agents.approvalSettled', { chatId: 'c1', approvalId: 'c1-seal' });
    await fixture.whenStable();
    expect(texts('gr-approvals-page .hint')).toEqual(['1 slip from 1 chapter, oldest first']);

    // Approving the last one turns the page back.
    emit('agents.approvalSettled', { chatId: 'c2', approvalId: 'c2-seal' });
    await fixture.whenStable();
    expect(el.querySelector('gr-approvals-page')).toBeNull();
    expect(texts('gr-right-page .tabs [aria-pressed="true"]')).toEqual(['Outline']);
  });

  it('opens an approval card\'s chat from the right page', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.openChats'] = () => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Fix flaky login test',
        settings: { cwd: 'C:/work' },
        status: 'waiting',
        entries: [],
        approvals: [{ id: 's1', chatId: 'c1', tool: 'Bash', input: { command: 'npm test' } }],
        queued: [],
        plan: [],
        withdrawn: [],
        pins: [],

        tags: [],
        copied: [],
      },
    ];
    const { fixture, el, texts } = await render(bridge);
    expect(texts('gr-page-header h1')).toEqual(['Untitled chapter']);
    el.querySelector<HTMLButtonElement>('gr-chat-tab[data-tone="approval"] button')!.click();
    await fixture.whenStable();

    el.querySelector<HTMLButtonElement>('gr-approvals-page gr-approval-card .gr-link')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-approvals-page')).toBeNull();
    expect(texts('gr-page-header h1')).toEqual(['Fix flaky login test']);
    expect(texts('gr-chat-page gr-approval-card .well')).toEqual(['$npm test']);
  });
});
