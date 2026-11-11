import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('UsagePage', () => {
  it('opens on the limits, and its tabs turn to where the tokens went and the tools', async () => {
    const { bridge, answers } = fakeBridge();
    answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: 0 });
    answers['usage.breakdown'] = () => null;
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Ledger');
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tabs button')];
    expect(tabs.map((tab) => tab.textContent!.trim())).toEqual([
      'Limits',
      'Where it went',
      'Tools & skills',
    ]);
    const selected = () => texts('gr-usage-page .tabs [aria-selected="true"]');
    expect(selected()).toEqual(['Limits']);

    tabs[2]!.click();
    await fixture.whenStable();
    expect(selected()).toEqual(['Tools & skills']);
  });
});
