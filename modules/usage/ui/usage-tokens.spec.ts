import type { CommandRequest, TokenTotals, UsageBreakdown, UsageSpan } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('usage-tokens', () => {
  // The page counts days and hours back from now, so the tests fix it.
  const now = new Date(2026, 10, 9, 15, 30).getTime();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('draws the tokens and the share served from the cache by day and by hour in the Usage page', async () => {
    const { bridge, answers } = fakeBridge();
    answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: 0 });
    answers['usage.breakdown'] = () => null;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const day = (back: number) => {
      const date = new Date(today);
      date.setDate(date.getDate() - back);
      const two = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    };
    const counts = (input: number, cacheRead: number, output: number) => ({
      input,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead,
      output,
      weight: input + cacheRead * 0.1 + output * 5,
    });
    const hour = new Date(now);
    hour.setMinutes(0, 0, 0);
    answers['search.tokens'] = ({ since }: CommandRequest<'search.tokens'>): TokenTotals => ({
      since,
      total: counts(1_300, 9_000, 100),
      days: [
        { day: day(2), ...counts(1_000, 3_000, 0) },
        { day: day(0), ...counts(300, 6_000, 100) },
      ],
      hours: [{ hour: hour.getTime(), ...counts(300, 6_000, 100) }],
      models: [],
      folders: [],
      chats: [],
      tools: [],
      skills: [],
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Where it went')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-usage-page figcaption')).toEqual(['Tokens by day', 'Served from the cache']);
    expect(texts('gr-usage-page gr-usage-columns .legend li')).toEqual([
      'Read from the cache',
      'Written to the cache',
      'Fresh input',
      'Output',
    ]);
    // A column for each day of the span, the days without turns empty.
    const columns = el.querySelectorAll('gr-usage-page gr-usage-columns rect.hit');
    expect(columns.length).toBeGreaterThanOrEqual(8);
    const rows = [...el.querySelectorAll('gr-usage-page gr-usage-columns tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim()),
    );
    // Weighed: a cache read a tenth, output five times.
    expect(rows[rows.length - 1]).toEqual(['600', '0', '300', '500', '1.4K']);
    expect(rows[rows.length - 2]).toEqual(['0', '0', '0', '0', '0']);
    expect(rows[rows.length - 3]).toEqual(['300', '0', '1K', '0', '1.3K']);
    expect(texts('gr-usage-page gr-usage-lines tbody td')).toEqual(['75%', '95%']);

    columns[columns.length - 1]!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(texts('gr-usage-page gr-usage-columns .tip strong')).toEqual([
      '1.4K',
      '600',
      '0',
      '300',
      '500',
    ]);

    [...el.querySelectorAll<HTMLButtonElement>('gr-usage-page .spans button')]
      .find((button) => button.textContent!.trim() === 'Last 24 hours')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-usage-page figcaption')).toEqual(['Tokens by hour', 'Served from the cache']);
    expect(
      el.querySelectorAll('gr-usage-page gr-usage-columns rect.hit').length,
    ).toBeGreaterThanOrEqual(24);
    expect(texts('gr-usage-page gr-usage-lines tbody td')).toEqual(['95%']);
  });

  it("shows where the tokens went in the Usage page, as Claude Code says and by Grimoire's count", async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: 0 });
    const span = (requests: number): UsageSpan => ({
      requests,
      chats: 4,
      behaviours: [
        { key: 'long_context', share: 80, requests: 40 },
        { key: 'brand_new', share: 5.4, requests: 2 },
      ],
      advice: [
        {
          key: 'long_context',
          share: 80,
          title: 'Start fresh when you switch tasks',
          detail: 'run /clear',
        },
      ],
      sources: [{ kind: 'mcp', name: 'docs', share: 9 }],
    });
    answers['usage.breakdown'] = (): UsageBreakdown => ({ day: span(10), week: span(70), at: 0 });
    const total = (weight: number) => ({
      input: weight,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead: 0,
      output: 0,
      weight,
    });
    answers['search.tokens'] = ({ since }: CommandRequest<'search.tokens'>): TokenTotals => ({
      since,
      total: total(4_000),
      days: [{ day: '2026-11-05', ...total(4_000) }],
      hours: [{ hour: new Date(2026, 10, 5, 14).getTime(), ...total(4_000) }],
      models: [
        { model: 'claude-opus-5-5', subagent: false, ...total(3_000) },
        { model: 'claude-haiku-4-5', subagent: true, ...total(1_000) },
      ],
      folders: [{ cwd: 'C:/work/grimoire', ...total(4_000) }],
      chats: [
        {
          id: 'old-1',
          agent: 'claude-code',
          title: 'Ribbon',
          cwd: 'C:/work/grimoire',
          ...total(4_000),
        },
      ],
      tools: [
        { name: 'Read', uses: 40 },
        { name: 'Bash', uses: 10 },
      ],
      skills: [{ name: 'code-review', uses: 1 }],
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    const showView = async (name: string) => {
      [...el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tabs button')]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await fixture.whenStable();
    };
    expect(texts('gr-usage-page h2')).toEqual(['Claude Code’s plan limits']);
    expect(texts('gr-usage-page .tabs [aria-selected="true"]')).toEqual(['Limits']);

    await showView('Where it went');
    expect(texts('gr-usage-page .spans [aria-checked="true"]')).toEqual(['Last 7 days']);
    const pick = async (name: string) => {
      [...el.querySelectorAll<HTMLButtonElement>('gr-usage-page .groups button')]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await fixture.whenStable();
    };
    expect(texts('gr-usage-page .tokens h3')).toEqual([
      'Claude Code’s advice',
      'By Grimoire’s count',
    ]);
    expect(texts('gr-usage-page .groups [aria-checked="true"]')).toEqual(['Day']);
    expect(texts('gr-usage-page .tokens h4')).toEqual(['Ways of working', 'What took a share']);
    const day = new Date(2026, 10, 5).toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    // Advice, the total, and the one list shown: by day.
    expect(
      texts(
        'gr-usage-page .tokens > .advice .name, .tokens > .total .name, .tokens > .limits .name',
      ),
    ).toEqual(['Start fresh when you switch tasks', '4K tokens', day]);
    expect(texts('gr-usage-page .tokens > .limits b')).toEqual(['100%']);
    await pick('Model');
    expect(texts('gr-usage-page .tokens > .limits .name')).toEqual([
      'Opus 5.5',
      'Subagents on Haiku 4.5',
    ]);
    expect(texts('gr-usage-page .tokens > .limits b')).toEqual(['75%', '25%']);
    await pick('Folder');
    expect(texts('gr-usage-page .tokens > .limits .name')).toEqual(['C:/work/grimoire']);
    await pick('Day');
    // Claude Code's own scan is collapsed, with the explanations.
    expect(texts('gr-usage-page .how summary')).toEqual([
      'Claude Code’s own scan',
      'How this is counted',
    ]);
    expect(texts('gr-usage-page .how .name')).toEqual(['Long context', 'brand new', 'docs']);
    // A way of working Grimoire has no name for keeps Claude Code's.
    expect(texts('gr-usage-page .how b')).toEqual(['80%', '5%', '9%']);
    expect(texts('gr-usage-page .tokens .detail')).toEqual(['run /clear', '4K fresh input']);
    expect(texts('gr-usage-page .how p')[0]).toBe('70 requests in 4 chats');

    await showView('Tools & skills');
    expect(texts('gr-usage-page .tokens h4')).toEqual([
      'The tools used most',
      'The skills used most',
    ]);
    expect(texts('gr-usage-page .tokens .name')).toEqual(['Read', 'Bash', 'code-review']);
    expect(texts('gr-usage-page .tokens b')).toEqual(['40', '10', '1']);
    // Each tool's and skill's uses, against the most used in its list.
    expect(texts('gr-usage-page [data-used] .resets')).toEqual(['40 uses', '10 uses', '1 use']);
    expect(
      [...el.querySelectorAll('gr-usage-page [data-used="tools"] [role="meter"]')].map((m) =>
        m.getAttribute('aria-valuenow'),
      ),
    ).toEqual(['100', '25']);
    await showView('Where it went');

    // The last 24 hours: Claude Code's scan already has them; Grimoire counts again.
    const asked = () =>
      calls
        .filter((c) => c.command === 'search.tokens')
        .map((c) => (c.request as CommandRequest<'search.tokens'>).since);
    [...el.querySelectorAll<HTMLButtonElement>('gr-usage-page .spans button')]
      .find((button) => button.textContent!.trim() === 'Last 24 hours')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-usage-page .how p')[0]).toBe('10 requests in 4 chats');
    expect(asked()).toHaveLength(2);
    expect(asked()[1]! - asked()[0]!).toBeGreaterThan(6 * 24 * 60 * 60_000 - 60_000);
    expect(calls.filter((c) => c.command === 'usage.breakdown')).toHaveLength(1);

    // A chat that weighed much opens from the list.
    await pick('Chat');
    [...el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tokens button.name')]
      .find((button) => button.textContent!.trim() === 'Ribbon')!
      .click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.open')!.request).toEqual({
      agent: 'claude-code',
      chatId: 'old-1',
      settings: { cwd: 'C:/work/grimoire' },
    });
  });

  it("says so in the Usage page when there's nothing to say of the tokens", async () => {
    const { bridge, answers } = fakeBridge();
    answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: 0 });
    answers['usage.breakdown'] = () => null;
    answers['search.tokens'] = () => {
      throw new Error('The search stopped');
    };
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-usage-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Where it went')!
      .click();
    await fixture.whenStable();
    // No scan from Claude Code: only Grimoire's count, which failed.
    expect(texts('gr-usage-page .tokens h3')).toEqual(['By Grimoire’s count']);
    expect(texts('gr-usage-page .tokens .none')).toEqual([
      'The chats’ tokens couldn’t be counted: The search stopped',
    ]);
  });
});
