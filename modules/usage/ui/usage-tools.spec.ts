import type { CommandRequest, TokenTotals } from '@grimoire/contract';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('usage-tools', () => {
  const zero = { input: 0, cacheWritten: 0, cacheWrittenLong: 0, cacheRead: 0, output: 0 };
  const none = { ...zero, cost: zero, dollars: 0 };

  async function showTools(totals: Partial<TokenTotals>) {
    const { bridge, answers, calls } = fakeBridge();
    answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: 0 });
    answers['usage.breakdown'] = () => null;
    answers['search.tokens'] = ({ since }: CommandRequest<'search.tokens'>): TokenTotals => ({
      since,
      total: none,
      unpriced: 0,
      chatCount: 0,
      days: [],
      hours: [],
      models: [],
      folders: [],
      chats: [],
      tools: [],
      skills: [],
      ...totals,
    });
    const rendered = await render(bridge);
    await openPageTab(rendered.fixture, rendered.el, 'Ledger');
    [...rendered.el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Tools & skills')!
      .click();
    await rendered.fixture.whenStable();
    return { ...rendered, calls };
  }

  it('shows the tools and skills used most, each against the most used in its list', async () => {
    const { el, texts } = await showTools({
      tools: [
        { name: 'Read', uses: 40 },
        { name: 'Bash', uses: 10 },
      ],
      skills: [{ name: 'code-review', uses: 1 }],
    });
    expect(texts('gr-usage-page .tools h4')).toEqual([
      'The tools used most',
      'The skills used most',
    ]);
    expect(texts('gr-usage-page .tools .name')).toEqual(['Read', 'Bash', 'code-review']);
    expect(texts('gr-usage-page .tools b')).toEqual(['40', '10', '1']);
    expect(texts('gr-usage-page [data-used] .resets')).toEqual(['40 uses', '10 uses', '1 use']);
    expect(
      [...el.querySelectorAll('gr-usage-page [data-used="tools"] [role="meter"]')].map((m) =>
        m.getAttribute('aria-valuenow'),
      ),
    ).toEqual(['100', '25']);
    expect(texts('gr-usage-page .tools .spans [aria-checked="true"]')).toEqual(['Last 7 days']);
  });

  it('says so when no tool or skill was used', async () => {
    const { texts } = await showTools({});
    expect(texts('gr-usage-page .tools .none')).toEqual([
      'No tools or skills were used over this span.',
    ]);
  });

  it('shares its span and its read with the Tokens tab', async () => {
    const { fixture, el, texts, calls } = await showTools({});
    const click = async (selector: string, name: string) => {
      [...el.querySelectorAll<HTMLButtonElement>(selector)]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await fixture.whenStable();
    };
    await click('gr-usage-page .tools .spans button', 'Last 24 hours');
    await click('gr-usage-page .tabs button', 'Tokens');
    expect(texts('gr-usage-page .tokens .spans [aria-checked="true"]')).toEqual(['Last 24 hours']);
    expect(calls.filter((c) => c.command === 'search.tokens')).toHaveLength(2);
    expect(calls.filter((c) => c.command === 'usage.breakdown')).toHaveLength(1);
  });
});
