import type { CommandRequest, TokenTotals, UsageBreakdown, UsageSpan } from '@grimoire/contract';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';
import { floorUnder } from './usage-tokens';
import { dollars, dollarsShort } from './usage-format';

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

  /** Tokens priced, for the tests, at a cent each fresh, a tenth of that read from the cache, and five cents out. */
  const counts = (input: number, cacheRead: number, output: number) => {
    const cost = {
      input: input * 0.01,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead: cacheRead * 0.001,
      output: output * 0.05,
    };
    return {
      input,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead,
      output,
      cost,
      dollars: cost.input + cost.cacheRead + cost.output,
    };
  };
  const none = { unpriced: 0, chatCount: 0, tools: [], skills: [] };

  async function showTokens(answers: ReturnType<typeof fakeBridge>['answers']) {
    const fake = fakeBridge();
    fake.answers['usage.plan'] = () => ({ plan: 'max', windows: [], at: 0 });
    fake.answers['usage.breakdown'] = () => null;
    Object.assign(fake.answers, answers);
    const rendered = await render(fake.bridge);
    await openPageTab(rendered.fixture, rendered.el, 'Ledger');
    const click = async (selector: string, name: string) => {
      [...rendered.el.querySelectorAll<HTMLButtonElement>(selector)]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await rendered.fixture.whenStable();
    };
    await click('gr-usage-page .tabs button', 'Tokens');
    return { ...fake, ...rendered, click };
  }

  it('sets the cache chart’s foot a little under its lowest share, on an even step', () => {
    expect(floorUnder(93.6)).toBe(92);
    expect(floorUnder(98)).toBe(96);
    expect(floorUnder(100)).toBe(98);
    expect(floorUnder(0)).toBe(0);
  });

  it('draws the tokens and the share served from the cache, by day and by hour', async () => {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const day = (back: number) => {
      const date = new Date(today);
      date.setDate(date.getDate() - back);
      const two = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    };
    const hour = new Date(now);
    hour.setMinutes(0, 0, 0);
    const { el, texts, click } = await showTokens({
      'search.tokens': ({ since }: CommandRequest<'search.tokens'>): TokenTotals => ({
        ...none,
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
      }),
    });

    expect(texts('gr-usage-page .tokens > gr-usage-columns figcaption')).toEqual([
      'By day Tokens Cost',
    ]);
    // What the four kinds are, behind an icon by the caption.
    expect(
      el.querySelector('gr-usage-page gr-usage-columns .about')!.getAttribute('title'),
    ).toContain('Output: what Claude writes, its thinking included; five times it.');
    expect(texts('gr-usage-page gr-usage-lines figcaption')).toEqual(['Served from the cache']);
    expect(texts('gr-usage-page gr-usage-columns .legend li')).toEqual([
      'Read from the cache',
      'Written to the cache',
      'Fresh input',
      'Output',
    ]);
    // A column for each day of the span, the days without turns empty, each with what it cost.
    const columns = [...el.querySelectorAll('gr-usage-page gr-usage-columns rect.hit')].map(
      (column) => column.getAttribute('aria-label')!,
    );
    expect(columns.length).toBeGreaterThanOrEqual(8);
    expect(columns.at(-1)).toContain(': 6.4K; Read from the cache 6K,');
    expect(columns.at(-1)).toContain(`; ${dollars(14)} at API prices`);
    expect(columns.at(-2)).toContain(': 0;');
    expect(columns.at(-3)).toContain(': 4K;');
    // Counted in dollars at a click, the tokens then in the tooltip.
    await click('gr-usage-page gr-usage-columns .groups button', 'Cost');
    const costs = [...el.querySelectorAll('gr-usage-page gr-usage-columns rect.hit')].map(
      (column) => column.getAttribute('aria-label')!,
    );
    expect(costs.at(-1)).toContain(
      `: ${dollarsShort(14)}; Read from the cache ${dollarsShort(6)},`,
    );
    expect(costs.at(-1)).toContain('; 6.4K tokens');
    await click('gr-usage-page gr-usage-columns .groups button', 'Tokens');

    // The cache line's scale starts under its worst day, 75% here.
    expect(texts('gr-usage-page gr-usage-lines .y-tick')).toEqual(['74%', '87%', '100%']);
    expect(el.querySelector('gr-usage-page table')).toBeNull();

    await click('gr-usage-page .spans button', 'Last 24 hours');
    expect(texts('gr-usage-page .tokens > gr-usage-columns figcaption')).toEqual([
      'By hour Tokens Cost',
    ]);
    expect(
      el.querySelectorAll('gr-usage-page gr-usage-columns rect.hit').length,
    ).toBeGreaterThanOrEqual(24);
  });

  it("shows the cost and the tokens, one ring split by what's picked, and the agent's word last", async () => {
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
    const { fixture, el, texts, click, calls } = await showTokens({
      'usage.breakdown': (): UsageBreakdown => ({ day: span(10), week: span(70), at: 0 }),
      'search.tokens': ({ since }: CommandRequest<'search.tokens'>): TokenTotals => ({
        ...none,
        since,
        total: counts(4_000, 10_000, 0),
        unpriced: 2_000,
        chatCount: 5,
        days: [{ day: '2026-11-05', ...counts(4_000, 10_000, 0) }],
        hours: [{ hour: new Date(2026, 10, 9, 14).getTime(), ...counts(4_000, 10_000, 0) }],
        models: [
          { model: 'claude-opus-5-5', subagent: false, ...counts(2_000, 10_000, 0) },
          { model: 'claude-haiku-4-5', subagent: true, ...counts(2_000, 0, 0) },
        ],
        folders: [{ cwd: 'C:/work/grimoire', ...counts(3_000, 10_000, 0) }],
        chats: [
          {
            id: 'old-1',
            agent: 'claude-code',
            title: 'Ribbon',
            cwd: 'C:/work/grimoire',
            ...counts(2_500, 10_000, 0),
          },
        ],
      }),
    });

    // Every token first, then what they'd cost at the API's prices, each explained on hover.
    expect(texts('gr-usage-page .total > span')).toEqual([
      '14K tokens',
      `${dollars(50)} at API prices`,
      '2K tokens of models without known prices aren’t counted',
    ]);
    const [tokens, cost] = el.querySelectorAll('gr-usage-page .total > span');
    expect(cost!.getAttribute('title')).toContain('list prices');
    expect(tokens!.getAttribute('title')).toBe('4K fresh input, 10K read from the cache');
    expect(el.querySelector('gr-usage-page details')).toBeNull();

    // One ring at a time, split by what's picked.
    expect(texts('gr-usage-page .split .groups button')).toEqual([
      'Day',
      'Model',
      'Folder',
      'Chat',
    ]);
    expect(el.querySelectorAll('gr-usage-page gr-usage-pie')).toHaveLength(1);
    const legend = () =>
      [...el.querySelectorAll('gr-usage-page gr-usage-pie .legend li')].map(
        (row) =>
          `${row.querySelector('.name')!.textContent!.trim()} ${row.querySelector('b')!.textContent}`,
      );
    const thursday = new Date(2026, 10, 5).toLocaleDateString([], { weekday: 'short' });
    expect(legend()).toEqual([`${thursday} 5 100%`]);
    await click('gr-usage-page .split .groups button', 'Model');
    expect(legend()).toEqual(['Opus 5.5 60%', 'Subagents on Haiku 4.5 40%']);
    // A turn with no folder, and the chats past the costliest, are slices too.
    await click('gr-usage-page .split .groups button', 'Folder');
    expect(legend()).toEqual(['C:/work/grimoire 80%', 'No folder 20%']);
    await click('gr-usage-page .split .groups button', 'Chat');
    expect(legend()).toEqual(['Ribbon 70%', 'Other · 4 chats 30%']);
    // The ring's middle says the cost and the tokens, of the whole until a slice is in focus.
    expect(texts('gr-usage-page gr-usage-pie .hole > *')).toEqual([dollars(50), '14K tokens']);
    el.querySelectorAll('gr-usage-page gr-usage-pie path.slice')[1]!.dispatchEvent(
      new FocusEvent('focus'),
    );
    await fixture.whenStable();
    expect(texts('gr-usage-page gr-usage-pie .hole > *')).toEqual([dollars(15), '1.5K tokens']);

    // The agent's word comes last, all of it together.
    expect(texts('gr-usage-page .tokens h3')).toEqual(['Claude Code says']);
    expect(el.querySelector('gr-usage-page .says h3')!.getAttribute('title')).toContain(
      'own look through the chats',
    );
    expect(el.querySelector('gr-usage-page .tokens > gr-usage-pie + .says')).not.toBeNull();
    expect(texts('gr-usage-page .says .sub')).toEqual(['70 requests in 4 chats']);
    expect(texts('gr-usage-page .says .advice .name')).toEqual([
      'Start fresh when you switch tasks',
    ]);
    expect(texts('gr-usage-page .says .advice .detail')).toEqual(['run /clear']);
    expect(texts('gr-usage-page .says h4')).toEqual(['Ways of working', 'What took a share']);
    expect(el.querySelector('gr-usage-page .says h4')!.getAttribute('title')).toContain('overlap');
    // A way of working Grimoire has no name for keeps Claude Code's.
    expect(texts('gr-usage-page .says .limits .name')).toEqual([
      'Long context',
      'brand new',
      'docs',
    ]);
    expect(texts('gr-usage-page .says .limits b')).toEqual(['80%', '5%', '9%']);

    // A chat opens from its slice.
    await click('gr-usage-page gr-usage-pie .legend button', 'Ribbon');
    expect(calls.find((c) => c.command === 'agents.open')!.request).toEqual({
      agent: 'claude-code',
      chatId: 'old-1',
      settings: { cwd: 'C:/work/grimoire' },
    });

    // The last 24 hours: by hour; Claude Code's scan already has them, Grimoire counts again.
    const asked = () =>
      calls
        .filter((c) => c.command === 'search.tokens')
        .map((c) => (c.request as CommandRequest<'search.tokens'>).since);
    await click('gr-usage-page .spans button', 'Last 24 hours');
    await click('gr-usage-page .split .groups button', 'Hour');
    const two = new Date(2026, 10, 9, 14);
    const weekday = two.toLocaleDateString([], { weekday: 'short' });
    expect(legend()).toEqual([
      `${weekday} ${two.toLocaleTimeString([], { hour: 'numeric' })} 100%`,
    ]);
    expect(texts('gr-usage-page .says .sub')).toEqual(['10 requests in 4 chats']);
    expect(asked()).toHaveLength(2);
    expect(asked()[1]! - asked()[0]!).toBeGreaterThan(6 * 24 * 60 * 60_000 - 60_000);
    expect(calls.filter((c) => c.command === 'usage.breakdown')).toHaveLength(1);
  });

  it("says so when there's nothing to say of the tokens", async () => {
    const { texts } = await showTokens({
      'search.tokens': () => {
        throw new Error('The search stopped');
      },
    });
    expect(texts('gr-usage-page .tokens h3')).toEqual([]);
    expect(texts('gr-usage-page .tokens .none')).toEqual([
      'The chats’ tokens couldn’t be counted: The search stopped',
    ]);
  });
});
