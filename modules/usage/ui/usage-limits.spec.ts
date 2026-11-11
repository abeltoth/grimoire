import type { UsageReading } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

describe('usage-limits', () => {
  // The page counts days and hours back from now, so the tests fix it.
  const now = new Date(2026, 10, 9, 15, 30).getTime();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows how much of the plan's limits is used in the Usage page, and reads it again", async () => {
    const { bridge, answers, calls } = fakeBridge();
    const tonight = new Date(now);
    tonight.setHours(23, 0, 0, 0);
    let used = 37;
    answers['usage.plan'] = () => ({
      plan: 'max',
      windows: [
        { span: 'session', used: used++, resetsAt: tonight.getTime() },
        { span: 'week', used: 70, resetsAt: null },
        { span: 'week', model: 'Opus', used: 12, resetsAt: null },
      ],
      at: tonight.getTime(),
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-tab-page .title')).toEqual(['Ledger']);
    expect(texts('gr-usage-page .plan h2')).toEqual(['Claude Code’s plan limits']);
    expect(texts('gr-usage-page .sub')[0]).toMatch(/^Max plan, read at .+Read again$/);
    expect(texts('gr-usage-page .plan .name')).toEqual([
      'Current session',
      'This week, all models',
      'This week, Opus',
    ]);
    expect(texts('gr-usage-page .plan b')).toEqual(['37%', '70%', '12%']);
    expect(texts('gr-usage-page .plan .resets')[0]).toMatch(/^resets at \S/);
    const meter = el.querySelector('gr-usage-page .plan [role="meter"]')!;
    expect(meter.getAttribute('aria-valuenow')).toBe('37');

    el.querySelector<HTMLButtonElement>('gr-usage-page .sub .gr-link')!.click();
    await fixture.whenStable();
    expect(texts('gr-usage-page .plan b')[0]).toBe('38%');
    expect(calls.filter((call) => call.command === 'usage.plan')).toHaveLength(2);
  });

  it("draws the week's limit as steps and each session's peak in the Usage page, with a row a day", async () => {
    const { bridge, answers, calls } = fakeBridge();
    const minutes = (n: number) => now - n * 60_000;
    const lastWeek = minutes(3 * 24 * 60);
    const nextWeek = now + 4 * 24 * 60 * 60_000;
    const firstSession = minutes(100);
    const secondSession = now + 270 * 60_000;
    answers['usage.plan'] = () => ({
      plan: 'max',
      windows: [
        { span: 'session', used: 40, resetsAt: secondSession },
        { span: 'week', used: 20, resetsAt: nextWeek },
      ],
      at: now,
    });
    answers['usage.history'] = (): UsageReading[] => [
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
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    const since = (calls.find((c) => c.command === 'usage.history')!.request as { since: number })
      .since;
    expect(now - since).toBeGreaterThan(7 * 24 * 60 * 60_000 - 60_000);
    expect(texts('gr-usage-page .plan figcaption')).toEqual([
      'The week\u2019s limit over the last 7 days',
      'How full each session got',
    ]);
    // One series each: the caption names it, with no legend.
    expect(el.querySelector('gr-usage-page .plan .legend')).toBeNull();
    // Last week's reading stands apart from this week's steps, with the new week marked.
    const steps = [...el.querySelectorAll('gr-usage-page .plan path.line')].map((p) =>
      p.getAttribute('d')!,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatch(/^M[\d.]+,[\d.]+H[\d.]+V[\d.]+$/);
    expect(texts('gr-usage-page .plan .mark-label')).toEqual(['New week']);
    expect(texts('gr-usage-page .plan .end-label')).toEqual(['20%']);

    // A row a day, in place of every reading.
    const rows = [...el.querySelectorAll('gr-usage-page .plan tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent!.trim()),
    );
    // Only the days anything was read.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows[0]).toEqual(['\u2013', '90%']);
    expect(rows.some(([, week]) => week === '20%')).toBe(true);

    // Two sessions, each at its peak.
    const sessions = el.querySelectorAll('gr-usage-page .plan gr-usage-columns rect.hit');
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.getAttribute('aria-label')).toMatch(/: 60%; /);
  });

  it("shows an organization's monthly allowance in the Usage page, with no session or week limits", async () => {
    const { bridge, answers } = fakeBridge();
    answers['usage.plan'] = () => ({
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
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    expect(texts('gr-usage-page .sub')[0]).toMatch(/^Enterprise plan, read at /);
    expect(texts('gr-usage-page .plan .none')).toEqual([]);
    const spent = (12345 / 100).toLocaleString([], { style: 'currency', currency: 'USD' });
    const limit = (600).toLocaleString([], { style: 'currency', currency: 'USD' });
    expect(texts('gr-usage-page .plan .name')).toEqual([
      `Usage credits this month ${spent} of ${limit}`,
    ]);
    expect(texts('gr-usage-page .plan .resets')[0]).toMatch(/^resets on \S/);
    expect(texts('gr-usage-page .plan b')).toEqual(['21%']);
    const meter = el.querySelector('gr-usage-page .plan [role="meter"]')!;
    expect(meter.getAttribute('aria-valuetext')).toBe(`${spent} of ${limit}`);
  });

  it('shows usage credits with no limit as money spent, without a meter', async () => {
    const { bridge, answers } = fakeBridge();
    answers['usage.plan'] = () => ({
      plan: 'team',
      windows: [],
      credits: { spent: 900, limit: null, currency: 'EUR', used: null, resetsAt: 0 },
      at: 0,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    const spent = (9).toLocaleString([], { style: 'currency', currency: 'EUR' });
    expect(texts('gr-usage-page .plan .spent')).toEqual([`${spent} spent, no limit`]);
    expect(el.querySelector('gr-usage-page .plan [role="meter"]')).toBeNull();
  });

  it('says so in the Usage page when the agent has no plan limits', async () => {
    const { bridge, answers } = fakeBridge();
    answers['usage.plan'] = () => ({ plan: null, windows: [], at: 0 });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-usage-page .plan .none')).toEqual([
      'No limits to show: Claude Code isn’t signed in with a Claude subscription.',
    ]);
  });
});
