import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('UsagePage', () => {
  it('opens on the limits, and its tabs turn to the tokens', async () => {
    const { bridge, answers } = fakeBridge();
    answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: 0 });
    answers['usage.breakdown'] = () => null;
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Ledger');
    const tabs = [...el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tabs button')];
    expect(tabs.map((tab) => tab.textContent!.trim())).toEqual(['Limits', 'Tokens']);
    const selected = () => texts('gr-usage-page .tabs [aria-selected="true"]');
    expect(selected()).toEqual(['Limits']);

    tabs[1]!.click();
    await fixture.whenStable();
    expect(selected()).toEqual(['Tokens']);
  });
});
