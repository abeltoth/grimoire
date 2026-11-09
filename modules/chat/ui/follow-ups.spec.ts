import type { CommandRequest, GrimoireSettings } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { fakeBridge, render, write } from '@ui/testing/app-harness';

describe('follow-ups', () => {
  it('offers separate tasks as cards under the last reply, each opening a new chapter with it written in', async () => {
    const { bridge, calls, answers, emit } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) => (kept = { ...kept, ...change });
    const offered = [
      { title: 'Write the docs', prompt: 'Document the meter\nin the README' },
      { title: 'Cut a release', prompt: '\nTag and publish 1.2' },
    ];
    answers['agents.takeFollowUp'] = ({ index }: CommandRequest<'agents.takeFollowUp'>) => {
      emit('agents.followUps', { chatId: 'chat-1', followUps: offered.filter((_, i) => i !== index) });
      return {
        agent: 'claude-code',
        settings: { cwd: 'C:/Users/me/git/grimoire', model: 'sonnet', mode: 'plan', mcpOff: ['github'] },
        prompt: offered[index]!.prompt,
      };
    };
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    const offer = async (followUps: typeof offered | null) => {
      emit('agents.followUps', { chatId: 'chat-1', followUps });
      await fixture.whenStable();
    };

    // Only once the turn has ended.
    await offer(offered);
    expect(el.querySelector('gr-follow-ups')).toBeNull();
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(texts('gr-transcript gr-follow-ups .head')).toEqual(['Separate chapters you could begin']);
    expect(texts('gr-follow-ups .title')).toEqual(['Write the docs', 'Cut a release']);
    expect(texts('gr-follow-ups .line')).toEqual(['Document the meter', 'Tag and publish 1.2']);

    // A click opens a blank chapter with the task written in, not sent; the other card stays.
    el.querySelectorAll<HTMLButtonElement>('gr-follow-ups .card')[1]!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.takeFollowUp').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', index: 1 },
    ]);
    expect(texts('[aria-current="page"] i')).toEqual(['Claude Code · blank page']);
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-entry')!.value).toBe('\nTag and publish 1.2');
    expect(texts('.meta button')).toContain('Sonnet 5.5');
    expect(texts('.meta button')).toContain('Plan only');
    expect(calls.filter((c) => c.command === 'agents.start')).toHaveLength(1);
    [...el.querySelectorAll<HTMLButtonElement>('gr-ribbon.chapter button')][0]!.click();
    await fixture.whenStable();
    expect(texts('gr-follow-ups .title')).toEqual(['Write the docs']);

    // All go once the next turn begins.
    emit('agents.status', { chatId: 'chat-1', status: 'thinking' });
    await offer(null);
    emit('agents.status', { chatId: 'chat-1', status: 'idle' });
    await fixture.whenStable();
    expect(el.querySelector('gr-follow-ups')).toBeNull();

    // The Colophon turns them off.
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    const off = [...el.querySelectorAll<HTMLButtonElement>('[aria-labelledby="gr-colophon-follow-ups"] .word')];
    expect(texts('#gr-colophon-follow-ups')).toEqual(['Suggest separate chapters']);
    off.find((button) => button.textContent!.trim() === 'Off')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { followUps: false },
    ]);
    expect(texts('[aria-labelledby="gr-colophon-follow-ups"] .word[aria-checked="true"]')).toEqual(['Off']);
  });
});
