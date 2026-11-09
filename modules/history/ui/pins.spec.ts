import type { OpenChat } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('pins', () => {
  it('pins and stars a chat, but not a blank one', async () => {
    const { bridge, calls, emit, answers } = fakeBridge();
    answers['agents.openChats'] = (): OpenChat[] => [
      {
        id: 'c1',
        agent: 'claude-code',
        title: 'Context meter',
        settings: { cwd: 'C:/work/grimoire' },
        status: 'idle',
        entries: [{ kind: 'user', id: 'u1', text: 'Add a meter' }],
        approvals: [],
        queued: [],
        plan: [],
        withdrawn: [],
        copied: [],
      },
    ];
    answers['layout.get'] = () => ({ current: 'c1' });
    answers['history.pinsAndTags'] = () => ({ pins: { c1: ['star'] }, tags: {} });
    const { fixture, el } = await render(bridge);
    const labels = () => [...el.querySelectorAll('gr-pins button')].map((b) => b.getAttribute('aria-label'));
    expect(labels()).toEqual(['Pin this chapter', 'Starred. Unfold to unstar']);

    el.querySelector<HTMLButtonElement>('gr-pins .pin')!.click();
    el.querySelector<HTMLButtonElement>('gr-pins .star')!.click();
    expect(calls.filter((c) => c.command === 'history.pin').map((c) => c.request)).toEqual([
      { chatId: 'c1', mark: 'pin', on: true },
      { chatId: 'c1', mark: 'star', on: false },
    ]);
    emit('history.pins', { chatId: 'c1', pins: ['pin'] });
    await fixture.whenStable();
    expect(labels()).toEqual(['Pinned. Unfold to unpin', 'Star this chapter']);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
    await fixture.whenStable();
    const blank = [...el.querySelectorAll('gr-pins button')];
    expect(blank.map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    (blank[0] as HTMLButtonElement).click();
    expect(calls.filter((c) => c.command === 'history.pin')).toHaveLength(2);
  });
});
