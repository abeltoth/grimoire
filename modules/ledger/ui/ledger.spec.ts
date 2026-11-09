import type {
  CommandRequest,
  TokenTotals,
  UsageBreakdown,
  UsageReading,
  UsageSpan,
} from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('ledger', () => {
  it('shows how much of the plan\'s limits is used in the Ledger, and reads it again', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const tonight = new Date();
    tonight.setHours(23, 0, 0, 0);
    let used = 37;
    answers['agents.usage'] = () => ({
      plan: 'max',
      windows: [
        { span: 'session', used: used++, resetsAt: tonight.getTime() },
        { span: 'week', used: 70, resetsAt: null },
        { span: 'week', model: 'Opus', used: 12, resetsAt: null },
      ],
      at: tonight.getTime(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-thumb-page .title')).toEqual(['Ledger']);
    expect(texts('gr-ledger-page .plan h2')).toEqual(['Claude Code’s plan limits']);
    expect(texts('gr-ledger-page .sub')[0]).toMatch(/^Max plan, read at .+Read again$/);
    expect(texts('gr-ledger-page .plan .name')).toEqual([
      'Current session',
      'This week, all models',
      'This week, Opus',
    ]);
    expect(texts('gr-ledger-page .plan b')).toEqual(['37%', '70%', '12%']);
    expect(texts('gr-ledger-page .plan .resets')[0]).toMatch(/^resets at \S/);
    const meter = el.querySelector('gr-ledger-page .plan [role="meter"]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('37');

    el.querySelector<HTMLButtonElement>('gr-ledger-page .sub .gr-link')!.click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan b')[0]).toBe('38%');
    expect(calls.filter((call) => call.command === 'agents.usage')).toHaveLength(2);
  });

  it("draws the week's limit as steps and each session's peak in the Ledger, with a row a day", async () => {
    const { bridge, answers, calls } = fakeBridge();
    const now = Date.now();
    const minutes = (n: number) => now - n * 60_000;
    const lastWeek = minutes(3 * 24 * 60);
    const nextWeek = now + 4 * 24 * 60 * 60_000;
    const firstSession = minutes(100);
    const secondSession = now + 270 * 60_000;
    answers['agents.usage'] = () => ({
      plan: 'max',
      windows: [
        { span: 'session', used: 40, resetsAt: secondSession },
        { span: 'week', used: 20, resetsAt: nextWeek },
      ],
      at: now,
    });
    answers['agents.usageHistory'] = (): UsageReading[] => [
      { at: minutes(4 * 24 * 60), span: 'week', used: 90, resetsAt: lastWeek },
      { at: minutes(300), span: 'session', used: 10, resetsAt: firstSession },
      { at: minutes(300), span: 'week', used: 15, resetsAt: nextWeek },
      // A reset read a few seconds off is the same session.
      { at: minutes(285), span: 'session', used: 60, resetsAt: firstSession + 30_000 },
      { at: minutes(30), span: 'session', used: 35, resetsAt: secondSession },
      { at: minutes(15), span: 'session', used: 40, resetsAt: secondSession },
      { at: minutes(15), span: 'week', used: 20, resetsAt: nextWeek },
    ];
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    const since = (calls.find((c) => c.command === 'agents.usageHistory')!.request as { since: number }).since;
    expect(now - since).toBeGreaterThan(7 * 24 * 60 * 60_000 - 60_000);
    expect(texts('gr-ledger-page .plan figcaption')).toEqual([
      'The week\u2019s limit over the last 7 days',
      'How full each session got',
    ]);
    // One series each: the caption names it, with no legend.
    expect(el.querySelector('gr-ledger-page .plan .legend')).toBeNull();
    // Last week's reading stands apart from this week's steps, with the new week marked.
    const steps = [...el.querySelectorAll('gr-ledger-page .plan path.line')].map((p) => p.getAttribute('d')!);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatch(/^M[\d.]+,[\d.]+H[\d.]+V[\d.]+$/);
    expect(texts('gr-ledger-page .plan .mark-label')).toEqual(['New week']);
    expect(texts('gr-ledger-page .plan .end-label')).toEqual(['20%']);

    // A row a day, in place of every reading.
    const rows = [...el.querySelectorAll('gr-ledger-page .plan tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim()),
    );
    // Only the days anything was read.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows[0]).toEqual(['\u2013', '90%']);
    expect(rows.some(([, week]) => week === '20%')).toBe(true);

    // Two sessions, each at its peak.
    const sessions = el.querySelectorAll('gr-ledger-page .plan gr-ledger-columns rect.hit');
    expect(sessions).toHaveLength(2);
    sessions[0]!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan gr-ledger-columns .tip strong')).toEqual(['60%']);

    // Focus puts the crosshair on the latest reading; the arrow keys step back.
    const plot = el.querySelector<SVGRectElement>('gr-ledger-page .plan gr-ledger-lines rect.hit')!;
    plot.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan gr-ledger-lines .tip strong')).toEqual(['20%']);
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan gr-ledger-lines .tip strong')).toEqual(['15%']);
    expect(plot.getAttribute('aria-label')).toMatch(/This week, all models 15%$/);
  });

  it('draws the tokens and the share served from the cache by day and by hour in the Ledger', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({ plan: 'max', windows: [], at: 0 });
    answers['agents.usageBreakdown'] = () => null;
    const today = new Date();
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
    const hour = new Date();
    hour.setMinutes(0, 0, 0);
    answers['tokens.totals'] = ({ since }: CommandRequest<'tokens.totals'>): TokenTotals => ({
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
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Where it went')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-ledger-page figcaption')).toEqual(['Tokens by day', 'Served from the cache']);
    expect(texts('gr-ledger-page gr-ledger-columns .legend li')).toEqual([
      'Read from the cache',
      'Written to the cache',
      'Fresh input',
      'Output',
    ]);
    // A column for each day of the span, the days without turns empty.
    const columns = el.querySelectorAll('gr-ledger-page gr-ledger-columns rect.hit');
    expect(columns.length).toBeGreaterThanOrEqual(8);
    const rows = [...el.querySelectorAll('gr-ledger-page gr-ledger-columns tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim()),
    );
    // Weighed: a cache read a tenth, output five times.
    expect(rows[rows.length - 1]).toEqual(['600', '0', '300', '500', '1.4K']);
    expect(rows[rows.length - 2]).toEqual(['0', '0', '0', '0', '0']);
    expect(rows[rows.length - 3]).toEqual(['300', '0', '1K', '0', '1.3K']);
    expect(texts('gr-ledger-page gr-ledger-lines tbody td')).toEqual(['75%', '95%']);

    columns[columns.length - 1]!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(texts('gr-ledger-page gr-ledger-columns .tip strong')).toEqual(['1.4K', '600', '0', '300', '500']);

    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .spans button')]
      .find((button) => button.textContent!.trim() === 'Last 24 hours')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page figcaption')).toEqual(['Tokens by hour', 'Served from the cache']);
    expect(el.querySelectorAll('gr-ledger-page gr-ledger-columns rect.hit').length).toBeGreaterThanOrEqual(24);
    expect(texts('gr-ledger-page gr-ledger-lines tbody td')).toEqual(['95%']);
  });

  it("shows an organization's monthly allowance in the Ledger, with no session or week limits", async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({
      plan: 'enterprise',
      windows: [],
      credits: {
        spent: 12345,
        limit: 60000,
        currency: 'USD',
        used: 20.575,
        resetsAt: new Date(2026, 11, 1).getTime(),
      },
      at: 0,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-ledger-page .sub')[0]).toMatch(/^Enterprise plan, read at /);
    expect(texts('gr-ledger-page .plan .none')).toEqual([]);
    const spent = (12345 / 100).toLocaleString([], { style: 'currency', currency: 'USD' });
    const limit = (600).toLocaleString([], { style: 'currency', currency: 'USD' });
    expect(texts('gr-ledger-page .plan .name')).toEqual([`Usage credits this month ${spent} of ${limit}`]);
    expect(texts('gr-ledger-page .plan .resets')[0]).toMatch(/^resets on \S/);
    expect(texts('gr-ledger-page .plan b')).toEqual(['21%']);
    const meter = el.querySelector('gr-ledger-page .plan [role="meter"]')!;
    expect(meter.getAttribute('aria-valuetext')).toBe(`${spent} of ${limit}`);
  });

  it('shows usage credits with no limit as money spent, without a meter', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({
      plan: 'team',
      windows: [],
      credits: { spent: 900, limit: null, currency: 'EUR', used: null, resetsAt: 0 },
      at: 0,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    const spent = (9).toLocaleString([], { style: 'currency', currency: 'EUR' });
    expect(texts('gr-ledger-page .plan .spent')).toEqual([`${spent} spent, no limit`]);
    expect(el.querySelector('gr-ledger-page .plan [role="meter"]')).toBeNull();
  });

  it('says so in the Ledger when the agent has no plan limits', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({ plan: null, windows: [], at: 0 });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page .plan .none')).toEqual([
      'No limits to show: Claude Code isn’t signed in with a Claude subscription.',
    ]);
  });

  it("shows where the tokens went in the Ledger, as Claude Code says and by Grimoire's count", async () => {
    const { bridge, answers, calls } = fakeBridge();
    answers['agents.usage'] = () => ({ plan: 'max', windows: [], at: 0 });
    const span = (requests: number): UsageSpan => ({
      requests,
      chats: 4,
      behaviours: [
        { key: 'long_context', share: 80, requests: 40 },
        { key: 'brand_new', share: 5.4, requests: 2 },
      ],
      advice: [{ key: 'long_context', share: 80, title: 'Start fresh when you switch tasks', detail: 'run /clear' }],
      sources: [{ kind: 'mcp', name: 'docs', share: 9 }],
    });
    answers['agents.usageBreakdown'] = (): UsageBreakdown => ({ day: span(10), week: span(70), at: 0 });
    const total = (weight: number) => ({
      input: weight,
      cacheWritten: 0,
      cacheWrittenLong: 0,
      cacheRead: 0,
      output: 0,
      weight,
    });
    answers['tokens.totals'] = ({ since }: CommandRequest<'tokens.totals'>): TokenTotals => ({
      since,
      total: total(4_000),
      days: [{ day: '2026-11-05', ...total(4_000) }],
      hours: [{ hour: new Date(2026, 10, 5, 14).getTime(), ...total(4_000) }],
      models: [
        { model: 'claude-opus-5-5', subagent: false, ...total(3_000) },
        { model: 'claude-haiku-4-5', subagent: true, ...total(1_000) },
      ],
      folders: [{ cwd: 'C:/work/grimoire', ...total(4_000) }],
      chats: [{ id: 'old-1', agent: 'claude-code', title: 'Ribbon', cwd: 'C:/work/grimoire', ...total(4_000) }],
      tools: [
        { name: 'Read', uses: 40 },
        { name: 'Bash', uses: 10 },
      ],
      skills: [{ name: 'code-review', uses: 1 }],
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    const showView = async (name: string) => {
      [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .tabs button')]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await fixture.whenStable();
    };
    expect(texts('gr-ledger-page h2')).toEqual(['Claude Code’s plan limits']);
    expect(texts('gr-ledger-page .tabs [aria-selected="true"]')).toEqual(['Limits']);

    await showView('Where it went');
    expect(texts('gr-ledger-page .spans [aria-checked="true"]')).toEqual(['Last 7 days']);
    const pick = async (name: string) => {
      [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .groups button')]
        .find((button) => button.textContent!.trim() === name)!
        .click();
      await fixture.whenStable();
    };
    expect(texts('gr-ledger-page .tokens h3')).toEqual(['Claude Code’s advice', 'By Grimoire’s count']);
    expect(texts('gr-ledger-page .groups [aria-checked="true"]')).toEqual(['Day']);
    expect(texts('gr-ledger-page .tokens h4')).toEqual(['Ways of working', 'What took a share']);
    const day = new Date(2026, 10, 5).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    // Advice, the total, and the one list shown: by day.
    expect(texts('gr-ledger-page .tokens > .advice .name, .tokens > .total .name, .tokens > .limits .name')).toEqual([
      'Start fresh when you switch tasks',
      '4K tokens',
      day,
    ]);
    expect(texts('gr-ledger-page .tokens > .limits b')).toEqual(['100%']);
    await pick('Model');
    expect(texts('gr-ledger-page .tokens > .limits .name')).toEqual(['Opus 5.5', 'Subagents on Haiku 4.5']);
    expect(texts('gr-ledger-page .tokens > .limits b')).toEqual(['75%', '25%']);
    await pick('Folder');
    expect(texts('gr-ledger-page .tokens > .limits .name')).toEqual(['C:/work/grimoire']);
    await pick('Day');
    // Claude Code's own scan is folded away, with the explanations.
    expect(texts('gr-ledger-page .how summary')).toEqual(['Claude Code’s own scan', 'How this is counted']);
    expect(texts('gr-ledger-page .how .name')).toEqual(['Long context', 'brand new', 'docs']);
    // A way of working Grimoire has no name for keeps Claude Code's.
    expect(texts('gr-ledger-page .how b')).toEqual(['80%', '5%', '9%']);
    expect(texts('gr-ledger-page .tokens .detail')).toEqual(['run /clear', '4K fresh input']);
    expect(texts('gr-ledger-page .how p')[0]).toBe('70 requests in 4 chats');

    await showView('Tools & skills');
    expect(texts('gr-ledger-page .tokens h4')).toEqual(['The tools used most', 'The skills used most']);
    expect(texts('gr-ledger-page .tokens .name')).toEqual(['Read', 'Bash', 'code-review']);
    expect(texts('gr-ledger-page .tokens b')).toEqual(['40', '10', '1']);
    // Each tool's and skill's uses, against the most used in its list.
    expect(texts('gr-ledger-page [data-used] .resets')).toEqual(['40 uses', '10 uses', '1 use']);
    expect(
      [...el.querySelectorAll('gr-ledger-page [data-used="tools"] [role="meter"]')].map((m) =>
        m.getAttribute('aria-valuenow'),
      ),
    ).toEqual(['100', '25']);
    await showView('Where it went');

    // The last 24 hours: Claude Code's scan already has them; Grimoire counts again.
    const asked = () =>
      calls
        .filter((c) => c.command === 'tokens.totals')
        .map((c) => (c.request as CommandRequest<'tokens.totals'>).since);
    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .spans button')]
      .find((button) => button.textContent!.trim() === 'Last 24 hours')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-ledger-page .how p')[0]).toBe('10 requests in 4 chats');
    expect(asked()).toHaveLength(2);
    expect(asked()[1]! - asked()[0]!).toBeGreaterThan(6 * 24 * 60 * 60_000 - 60_000);
    expect(calls.filter((c) => c.command === 'agents.usageBreakdown')).toHaveLength(1);

    // A chat that weighed much opens from the list.
    await pick('Chat');
    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .tokens button.name')]
      .find((button) => button.textContent!.trim() === 'Ribbon')!
      .click();
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.open')!.request).toEqual({
      agent: 'claude-code',
      chatId: 'old-1',
      settings: { cwd: 'C:/work/grimoire' },
    });
  });

  it("says so in the Ledger when there's nothing to say of the tokens", async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.usage'] = () => ({ plan: 'max', windows: [], at: 0 });
    answers['agents.usageBreakdown'] = () => null;
    answers['tokens.totals'] = () => {
      throw new Error('The search stopped');
    };
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-thumb-index .thumb')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    [...el.querySelectorAll<HTMLButtonElement>('gr-ledger-page .tabs button')]
      .find((button) => button.textContent!.trim() === 'Where it went')!
      .click();
    await fixture.whenStable();
    // No scan from Claude Code: only Grimoire's count, which failed.
    expect(texts('gr-ledger-page .tokens h3')).toEqual(['By Grimoire’s count']);
    expect(texts('gr-ledger-page .tokens .none')).toEqual([
      'The chats’ tokens couldn’t be counted: The search stopped',
    ]);
  });
});
