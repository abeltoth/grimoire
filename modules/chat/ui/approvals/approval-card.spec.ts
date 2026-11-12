import { fakeBridge, render, write } from '@ui/testing/app-testing';

describe('approval-card', () => {
  it('tucks an approval into the page and approves it', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Push it');
    emit('agents.approval', {
      approval: {
        id: 'ap1',
        chatId: 'chat-1',
        tool: 'Bash',
        input: { command: 'git push origin main', description: 'Pushes the branch' },
        alwaysAllow: { rule: 'git push', scope: 'project' },
      },
    });
    emit('agents.status', { chatId: 'chat-1', status: 'waiting' });
    await fixture.whenStable();

    // One heading, then what it's for; the chat's own folder goes unsaid.
    expect(texts('gr-approval-card .head > *')).toEqual([
      '¶ Claude Code seeks your seal to run a command',
    ]);
    expect(texts('gr-approval-card .about')).toEqual(['Pushes the branch']);
    expect(texts('gr-approval-card .well')).toEqual(['$git push origin main']);
    expect(el.querySelector('gr-approval-card .meta')).toBeNull();
    expect(texts('gr-approval-card .choice')).toEqual([
      'Always allow git push in this project ⇧⏎',
      'Deny Esc',
    ]);
    expect(texts('.stop')).toEqual([]);
    expect(texts('gr-chat-tab .approval')).toEqual(['1']);
    expect(document.activeElement?.textContent).toContain('Allow once');

    el.querySelector<HTMLButtonElement>('gr-approval-card .approve-button')!.click();
    el.querySelector('gr-approval-card')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(calls.filter((c) => c.command === 'agents.decide').map((c) => c.request)).toEqual([
      { approvalId: 'ap1', decision: 'allow-once' },
      { approvalId: 'ap1', decision: 'allow-always' },
      { approvalId: 'ap1', decision: 'deny' },
    ]);
    expect(calls.some((c) => c.command === 'agents.interrupt')).toBe(false);

    emit('agents.approvalSettled', { chatId: 'chat-1', approvalId: 'ap1' });
    await fixture.whenStable();
    expect(el.querySelector('gr-approval-card')).toBeNull();
    expect(texts('gr-chat-tab .approval')).toEqual([]);
  });

  it('calls a rule that is the command itself "this command"', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Look');
    emit('agents.approval', {
      approval: {
        id: 'ap3',
        chatId: 'chat-1',
        tool: 'Bash',
        input: { command: 'grep -n well approval-card.html | head -60' },
        alwaysAllow: { rule: 'grep -n well approval-card.html | head -60', scope: 'project' },
      },
    });
    await fixture.whenStable();
    expect(texts('gr-approval-card .choice')).toEqual([
      'Always allow this command in this project ⇧⏎',
      'Deny Esc',
    ]);
    expect(el.querySelector('gr-approval-card .about')).toBeNull();
  });

  it('reads a plan as its markdown, to start on or keep planning', async () => {
    const { bridge, calls, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Plan it');
    emit('agents.approval', {
      approval: {
        id: 'ap4',
        chatId: 'chat-1',
        tool: 'ExitPlanMode',
        input: { plan: '# Plan: the meter\n\n- Count the tokens\n- Show "used"' },
        alwaysAllow: { scope: 'project' },
      },
    });
    await fixture.whenStable();
    expect(texts('gr-approval-card .head > *')).toEqual([
      '¶ Claude Code has drawn up a plan. Begin on it?',
    ]);
    expect(texts('gr-approval-card .plan .heading')).toEqual(['Plan: the meter']);
    expect(texts('gr-approval-card .plan li')).toEqual(['Count the tokens', 'Show "used"']);
    expect(el.querySelector('gr-approval-card .well')).toBeNull();
    expect(texts('gr-approval-card .approve-button')).toEqual(['Start on it ⏎']);
    expect(texts('gr-approval-card .choice')).toEqual(['Keep planning Esc']);

    // Shift+Enter has no Always allow to take.
    el.querySelector('gr-approval-card')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }),
    );
    expect(calls.some((c) => c.command === 'agents.decide')).toBe(false);
  });

  it("shows another tool's input a line each", async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Fetch it');
    emit('agents.approval', {
      approval: {
        id: 'ap5',
        chatId: 'chat-1',
        tool: 'WebFetch',
        input: { url: 'https://angular.dev', prompt: 'Find "signals"' },
      },
    });
    await fixture.whenStable();
    expect(texts('gr-approval-card .head > *')).toEqual([
      '¶ Claude Code seeks your seal to use WebFetch',
    ]);
    expect(el.querySelector('gr-approval-card .well.detail')!.textContent).toBe(
      'url: https://angular.dev\nprompt: Find "signals"',
    );
  });

  it('shows a file change as a diff on the approval card', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Rename it');
    emit('agents.approval', {
      approval: {
        id: 'ap2',
        chatId: 'chat-1',
        tool: 'Edit',
        input: {
          file_path: 'C:/work/grimoire/src/a.ts',
          old_string: 'const a = 1;\nexport { a };',
          new_string: 'const b = 1;\nexport { b };',
        },
        alwaysAllow: { scope: 'chat' },
      },
    });
    await fixture.whenStable();
    expect(texts('gr-diff-view .head b')).toEqual(['src/a.ts']);
    expect(texts('gr-diff-view .line .mark')).toEqual(['dele', 'dele', '‸ insert 2 lines', '']);
    expect(texts('gr-approval-card .choice')).toEqual([
      'Always allow edits in this chapter ⇧⏎',
      'Deny Esc',
    ]);
  });
});
