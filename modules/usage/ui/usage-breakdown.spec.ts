import type { UsageBreakdown, UsageSpan } from '@grimoire/contract';
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

  async function showLimits(breakdown: () => UsageBreakdown | null) {
    const fake = fakeBridge();
    fake.answers['usage.plan'] = () => ({
      plan: 'max',
      windows: [{ span: 'week', used: 40, resetsAt: null }],
      at: now,
    });
    fake.answers['usage.breakdown'] = breakdown;
    const rendered = await render(fake.bridge);
    await openPageTab(rendered.fixture, rendered.el, 'Ledger');
    const click = async (selector: string, name: string) => {
      [...rendered.el.querySelectorAll<HTMLButtonElement>(selector)]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await rendered.fixture.whenStable();
    };
    return { ...fake, ...rendered, click };
  }

  it("shows what used the plan's limits by the agent's own scan, under the limits", async () => {
    const { el, texts, click, calls, fixture } = await showLimits(() => ({ day, week, at: now }));
    const panel = 'gr-usage-page .plan gr-usage-breakdown';

    expect(texts(`${panel} h3`)).toEqual(['What used your limits']);
    expect(el.querySelector(`${panel} h3 .about`)!.getAttribute('aria-label')).toContain(
      'Claude Code’s own scan of the chats on this computer, read at',
    );
    expect(texts(`${panel} .sub`)).toEqual([
      'Last 24 hours Last 7 days · 66 chats · 4,002 requests',
    ]);
    expect(texts(`${panel} .spans [aria-checked="true"]`)).toEqual(['Last 7 days']);
    expect(texts(`${panel} h4`)).toEqual([
      'Ways of working',
      'Where it went',
      'Plugins and MCP servers',
      'Claude Code’s tips',
    ]);

    // Ways of working and plugins and MCP servers as meters, a whole chat counted for those that count by chat.
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
    // What each counts, for those Grimoire knows, and that they overlap.
    el.querySelector(`${panel} h4 .about`)!.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(texts(`${panel} h4 .about-head`)).toEqual([
      'Long context',
      'Chats left running for hours',
    ]);
    expect(texts(`${panel} h4 .about-row`).at(-1)).toBe(
      'They overlap, so their shares don’t add up to 100%.',
    );

    // One ring: the chat's own share and each subagent and skill.
    const legend = [...el.querySelectorAll(`${panel} gr-usage-pie .legend li`)].map(
      (row) =>
        `${row.querySelector('.name')!.textContent!.trim()} ${row.querySelector('b')!.textContent}`,
    );
    expect(legend).toEqual(['Chat 80%', 'commit · skill 15%', 'Explore · subagent 5%']);

    // The tips last: what to do, the command to run, and the share each touches.
    expect(texts(`${panel} .tips .advice-title`)).toEqual([
      'Start fresh when you switch tasks',
      'Run /commit on a cheaper model',
      'Review sessions active over many hours',
    ]);
    expect(texts(`${panel} .tips code`)).toEqual(['/clear']);
    expect(texts(`${panel} .tips .advice-detail`)).toEqual([
      'whole sessions with requests in 8 or more separate hours',
    ]);
    expect(texts(`${panel} .tips .pill`)).toEqual(['59%', '15%', '10%']);

    await click(`${panel} .spans button`, 'Last 24 hours');
    expect(texts(`${panel} .none`)).toEqual(['No requests over this span.']);

    // Reading the limits again reads the scan again.
    el.querySelector<HTMLButtonElement>('gr-usage-page .plan > .sub .gr-link')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'usage.breakdown')).toHaveLength(2);
  });

  it("says so when the agent couldn't scan", async () => {
    const { texts } = await showLimits(() => {
      throw new Error('No answer');
    });
    expect(texts('gr-usage-page gr-usage-breakdown .none')).toEqual([
      'Claude Code couldn’t say what used the limits: No answer',
    ]);
  });
});
