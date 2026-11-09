import { fakeBridge, render, write } from '@ui/testing/app-harness';

describe('approval-slip', () => {
  it('tucks an approval into the page and seals it', async () => {
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

    expect(texts('gr-approval-slip .head > *')).toEqual([
      '¶ Awaiting your seal',
      'Claude Code asks to run this command',
    ]);
    expect(texts('gr-approval-slip .well')).toEqual(['$git push origin main']);
    expect(texts('gr-approval-slip .meta span')).toEqual([
      'Runs in C:/work/grimoire',
      'Pushes the branch',
    ]);
    expect(texts('gr-approval-slip .choice')).toEqual([
      'Always allow git push in this project ⇧⏎',
      'Deny Esc',
    ]);
    expect(texts('.stop')).toEqual([]);
    expect(texts('gr-ribbon .seal')).toEqual(['1']);
    expect(document.activeElement?.textContent).toContain('Allow once');

    el.querySelector<HTMLButtonElement>('gr-approval-slip .seal-button')!.click();
    el.querySelector('gr-approval-slip')!.dispatchEvent(
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
    expect(el.querySelector('gr-approval-slip')).toBeNull();
    expect(texts('gr-ribbon .seal')).toEqual([]);
  });

  it('shows a file change as corrections on the slip', async () => {
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
    expect(texts('gr-corrections .head b')).toEqual(['src/a.ts']);
    expect(texts('gr-corrections .line .mark')).toEqual(['dele', 'dele', '‸ insert 2 lines', '']);
    expect(texts('gr-approval-slip .choice')).toEqual([
      'Always allow edits in this chapter ⇧⏎',
      'Deny Esc',
    ]);
  });
});
