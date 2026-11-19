import type { CommandRequest, TokenTotals, ToolGroups, UsedTool } from '@grimoire/contract';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('UsageToolRing', () => {
  const now = new Date(2026, 10, 9, 15, 30).getTime();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const zero = { input: 0, cacheWritten: 0, cacheWrittenLong: 0, cacheRead: 0, output: 0 };
  const spent = { ...zero, input: 1_000, cost: { ...zero, input: 10 }, dollars: 10 };

  async function showRing(tools: UsedTool[], groups?: () => ToolGroups) {
    const fake = fakeBridge();
    fake.answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: 0 });
    fake.answers['usage.breakdown'] = () => null;
    fake.answers['search.tokens'] = ({ since }: CommandRequest<'search.tokens'>): TokenTotals => ({
      since,
      total: spent,
      unpriced: 0,
      chatCount: 1,
      days: [],
      hours: [],
      models: [],
      folders: [],
      sources: [],
      chats: [],
      tools,
      skills: [],
    });
    if (groups) fake.answers['search.toolGroups'] = groups;
    const rendered = await render(fake.bridge);
    await openPageTab(rendered.fixture, rendered.el, 'Ledger');
    [...rendered.el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Tokens')!
      .click();
    await rendered.fixture.whenStable();
    const head = () => rendered.texts('gr-usage-tool-ring .split')[0]!.replace(/\s+/g, ' ');
    const legend = () => rendered.texts('gr-usage-tool-ring gr-usage-pie .legend .name');
    return { ...fake, ...rendered, head, legend };
  }

  it('rings the tools by the context their results added, after the cost’s ring', async () => {
    const { el, head, legend, texts } = await showRing([
      { name: 'Bash', uses: 112, context: 61_000 },
      { name: 'Read', uses: 40, context: 182_000 },
      { name: 'Grep', uses: 30, context: 4_000 },
    ]);
    expect(head()).toBe('Context by tool');
    expect(el.querySelector('gr-usage-tool-ring .split gr-usage-about')).not.toBeNull();
    expect(legend()).toEqual(['Read', 'Bash', 'Grep']);
    // Only a tool that breaks down can be picked.
    expect(texts('gr-usage-tool-ring .legend button.name')).toEqual(['Read', 'Bash']);
    const grep = el.querySelectorAll('gr-usage-tool-ring .slice')[2]!;
    expect(grep.getAttribute('aria-label')).toBe('Grep: 4K, 2%, 30 uses');
    const rings = [...el.querySelectorAll('gr-usage-pie')];
    expect(rings).toHaveLength(2);
    expect(rings[1]!.closest('gr-usage-tool-ring')).not.toBeNull();
  });

  it("turns into a tool's calls by command when it's picked, and back", async () => {
    const { el, fixture, head, legend, calls } = await showRing(
      [{ name: 'Bash', uses: 12, context: 10_000 }],
      () => ({
        uses: 12,
        context: 10_000,
        groups: [
          { name: 'git diff', uses: 4, context: 6_000 },
          { name: 'npm test', uses: 2, context: 3_000 },
        ],
        more: 2,
      }),
    );
    el.querySelector<HTMLButtonElement>('gr-usage-tool-ring .legend button.name')!.click();
    await fixture.whenStable();
    const asked = calls.find((call) => call.command === 'search.toolGroups')!;
    expect(asked.request).toEqual({ since: expect.any(Number), tool: 'Bash' });
    expect(head()).toBe('‹ All tools Bash by command');
    expect(legend()).toEqual(['git diff', 'npm test', 'Other · 2 commands']);
    // Nothing in it opens further.
    expect(el.querySelector('gr-usage-tool-ring .legend button.name')).toBeNull();

    el.querySelector<HTMLButtonElement>('gr-usage-tool-ring .back')!.click();
    await fixture.whenStable();
    expect(head()).toBe('Context by tool');
    expect(legend()).toEqual(['Bash']);
  });

  it("says so when a tool's calls can't be counted", async () => {
    const { el, fixture, texts } = await showRing([{ name: 'Read', uses: 4, context: 900 }], () => {
      throw new Error('The search stopped');
    });
    el.querySelector<HTMLButtonElement>('gr-usage-tool-ring .legend button.name')!.click();
    await fixture.whenStable();
    expect(texts('gr-usage-tool-ring .none')).toEqual([
      'Its calls couldn’t be counted: The search stopped',
    ]);
  });

  it('says so when no tool could be measured', async () => {
    const { texts } = await showRing([{ name: 'Read', uses: 4, context: 0 }]);
    expect(texts('gr-usage-tool-ring .none')).toEqual([
      'No tool’s context could be measured over this span.',
    ]);
  });
});
