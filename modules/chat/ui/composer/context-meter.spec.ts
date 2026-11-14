import { fakeBridge, render, write } from '@ui/testing/app-testing';

describe('context meter', () => {
  it('shows how much of the page allowance the chat uses', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    expect(el.querySelector('.allowance')).toBeNull();
    await write(fixture, el, 'Add the meter');
    emit('agents.context', { chatId: 'chat-1', context: { used: 124_000, limit: 200_000 } });
    await fixture.whenStable();
    expect(texts('.allowance .gauge > *')).toEqual([
      '',
      '62%',
      '124K / 200K',
      'of the chapter’s page allowance',
    ]);
    const gauge = el.querySelector('.allowance .gauge')!;
    expect(gauge.getAttribute('aria-label')).toBe(
      'Context window: 62% used, 124K / 200K. Change how it compacts',
    );
    expect(gauge.getAttribute('title')).toBe('124,000 of 200,000 tokens');
    expect(el.querySelector<HTMLElement>('.allowance .used')!.style.width).toBe('62%');
  });

  it('fills toward where the agent compacts the chat, and moves with each report', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    const context = { limit: 1_000_000, compactsAt: 400_000 };
    emit('agents.context', { chatId: 'chat-1', context: { used: 100_000, ...context } });
    await fixture.whenStable();
    expect(texts('.allowance .gauge > *')).toEqual(['', '25%', '100K / 400K']);
    expect(el.querySelector('.allowance .gauge')!.getAttribute('title')).toBe(
      '100,000 of 1,000,000 tokens; compacts at 400,000',
    );
    emit('agents.context', { chatId: 'chat-1', context: { used: 440_000, ...context } });
    await fixture.whenStable();
    expect(texts('.allowance b')).toEqual(['110%']);
    expect(el.querySelector<HTMLElement>('.allowance .used')!.style.width).toBe('100%');
  });

  it('opens and closes how the agent compacts the chat', async () => {
    const { bridge, emit, answers } = fakeBridge();
    answers['agents.compaction'] = () => null;
    const { fixture, el } = await render(bridge);
    await write(fixture, el, 'Add the meter');
    emit('agents.context', { chatId: 'chat-1', context: { used: 9_000, limit: 200_000 } });
    await fixture.whenStable();
    const gauge = el.querySelector<HTMLButtonElement>('.allowance .gauge')!;
    gauge.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-compaction-card')).not.toBeNull();
    expect(gauge.getAttribute('aria-expanded')).toBe('true');
    gauge.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-compaction-card')).toBeNull();
  });
});
