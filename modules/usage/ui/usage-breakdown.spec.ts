import type { CommandRequest, TokenTotals, UsageBreakdown, UsageSpan } from '@grimoire/contract';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('usage-breakdown', () => {
  const now = new Date(2026, 10, 9, 15, 30).getTime();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const week: UsageSpan = {
    requests: 4002,
    chats: 66,
    behaviours: [
      { key: 'long_context', share: 59, requests: 2000 },
      { key: 'cron', share: 10, requests: 3 },
      { key: 'brand_new', share: 2, requests: 1 },
    ],
    advice: [
      {
        key: 'long_context',
        share: 59,
        title: 'Start fresh when you switch tasks',
        detail: 'run /clear',
      },
      { key: 'skill', share: 15, title: 'Run /commit on a cheaper model' },
      {
        key: 'cron',
        share: 10,
        title: 'Review sessions active over many hours',
        detail: 'whole sessions with requests in 8 or more separate hours',
      },
    ],
    sources: [
      { kind: 'skill', name: 'commit', share: 15 },
      { kind: 'mcp', name: 'docs', share: 9 },
      { kind: 'agent', name: 'Explore', share: 5 },
    ],
  };
  const day: UsageSpan = { requests: 0, chats: 0, behaviours: [], advice: [], sources: [] };
  const zero = { input: 0, cacheWritten: 0, cacheWrittenLong: 0, cacheRead: 0, output: 0 };

  async function showTokens(breakdown: () => UsageBreakdown | null) {
    const fake = fakeBridge();
    fake.answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: now });
    fake.answers['usage.breakdown'] = breakdown;
    fake.answers['search.tokens'] = ({ since }: CommandRequest<'search.tokens'>): TokenTotals => ({
      since,
      total: { ...zero, cost: zero, dollars: 0 },
      unpriced: 0,
      chatCount: 0,
      days: [],
      hours: [],
      models: [],
      folders: [],
      sources: [],
      chats: [],
      tools: [],
      skills: [],
    });
    const rendered = await render(fake.bridge);
    await openPageTab(rendered.fixture, rendered.el, 'Ledger');
    const click = async (selector: string, name: string) => {
      [...rendered.el.querySelectorAll<HTMLButtonElement>(selector)]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await rendered.fixture.whenStable();
    };
    expect(rendered.el.querySelector('gr-usage-limits gr-usage-breakdown')).toBeNull();
    await click('gr-usage-page .tabs button', 'Tokens');
    return { ...fake, ...rendered, click };
  }

  it("shows the agent's own scan under the cost, over the tab's span", async () => {
    const { el, texts, click, calls, fixture } = await showTokens(() => ({ day, week, at: now }));
    const panel = 'gr-usage-page .tokens gr-usage-breakdown';

    // No title of its own: the tab is about where the usage went.
    expect(texts(`${panel} h3`)).toEqual([]);
    expect(texts(`${panel} h4`)).toEqual([
      'Ways of working',
      'Plugins and MCP servers',
      'Claude Code’s tips',
    ]);

    // Ways of working and the MCP servers as meters, a whole chat counted for those counted by chat.
    expect(texts(`${panel} .limits .name`)).toEqual([
      'Long context',
      'Chats left running for hours',
      'brand new',
      'docs',
    ]);
    expect(texts(`${panel} .limits .resets`)).toEqual([
      '2,000 requests',
      '3 chats',
      '1 request',
      'MCP server',
    ]);
    expect(texts(`${panel} .limits b`)).toEqual(['59%', '10%', '2%', '9%']);

    // Each way of working Grimoire knows tells what it counts, on its own name.
    const words = el.querySelectorAll(`${panel} .limits .name .about.word`);
    expect(words).toHaveLength(2);
    expect(words[0]!.getAttribute('aria-description')).toBe(
      'A request whose context is over 150K tokens.',
    );
    words[0]!.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(texts(`${panel} .about-tip`)).toEqual(['A request whose context is over 150K tokens.']);
    words[0]!.dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();

    // The tips last, in a note of their own: what to do and the command to run, no shares.
    expect(texts(`${panel} .tips .advice-title`)).toEqual([
      'Start fresh when you switch tasks',
      'Run /commit on a cheaper model',
      'Review sessions active over many hours',
    ]);
    expect(texts(`${panel} .tips code`)).toEqual(['/clear']);
    expect(texts(`${panel} .tips .advice-detail`)).toEqual([
      'whole sessions with requests in 8 or more separate hours',
    ]);
    expect(texts(`${panel} .tips`)[0]).not.toContain('%');

    // The tab's span picks the scan's.
    await click('gr-usage-page .tokens .spans button', 'Last 24 hours');
    expect(texts(`${panel} h4`)).toEqual([]);

    // Reading again asks for the scan again.
    await click('gr-usage-page .tokens .sub .gr-link', 'Read again');
    expect(calls.filter((c) => c.command === 'usage.breakdown')).toHaveLength(2);
  });

  it("says so when the agent couldn't scan", async () => {
    const { texts } = await showTokens(() => {
      throw new Error('No answer');
    });
    expect(texts('gr-usage-page .tokens > .none[role="alert"]')).toEqual([
      'Claude Code couldn’t say where the usage went: No answer',
    ]);
  });
});
