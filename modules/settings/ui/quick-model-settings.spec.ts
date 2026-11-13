import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('QuickModelSettings', () => {
  it('picks the model each agent does quick jobs on, the one it recommends until you pick another', async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['agents.list'] = () => [
      { id: 'claude-code', name: 'Claude Code', capabilities: ['ask'] },
      { id: 'other', name: 'Other agent', capabilities: [] },
    ];
    answers['agents.models'] = () => ({
      models: [
        { id: 'opus', name: 'Opus' },
        { id: 'haiku', name: 'Haiku' },
      ],
      default: 'opus',
      quick: 'haiku',
    });
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Colophon');
    const word = (name: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-quick-model-settings .word')].find(
        (button) => button.textContent!.trim() === name,
      )!;

    // Only an agent that answers prompts has a model to pick.
    expect(texts('gr-quick-model-settings .label')).toEqual(['Claude Code']);
    expect(texts('gr-quick-model-settings .word')).toEqual(['Opus', 'Haiku']);
    expect(word('Haiku').getAttribute('aria-checked')).toBe('true');
    expect(texts('gr-quick-model-settings .note')).toEqual(['Claude Code recommends Haiku.']);

    word('Opus').click();
    await fixture.whenStable();
    expect(word('Opus').getAttribute('aria-checked')).toBe('true');
    // Picking the recommended one again follows the agent's choice.
    word('Haiku').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'settings.set').map((c) => c.request)).toEqual([
      { quickModels: { 'claude-code': 'opus' } },
      { quickModels: {} },
    ]);
  });

  it('shows nothing when no agent answers prompts', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el } = await render(bridge);
    await openPageTab(fixture, el, 'Colophon');
    expect(el.querySelector('gr-quick-model-settings section')).toBeNull();
  });
});
