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

  it('draws the week under way with its pace, its sessions and the weeks before in the Usage page', async () => {
    const { bridge, answers, calls } = fakeBridge();
    const hour = 60 * 60_000;
    const end = now + 3 * 24 * hour;
    const session = now + 2 * hour;
    answers['usage.plan'] = () => ({
      plan: 'max',
      windows: [
        { span: 'session', used: 40, resetsAt: session },
        { span: 'week', used: 20, resetsAt: end },
      ],
      at: now,
    });
    answers['usage.history'] = (): UsageReading[] => [
      { at: now - 48 * hour, span: 'week', used: 10, resetsAt: end },
      { at: now - 2 * hour, span: 'session', used: 40, resetsAt: session },
      { at: now - 2 * hour, span: 'week', used: 20, resetsAt: end },
    ];
    const week = 7 * 24 * hour;
    answers['usage.weeks'] = () => [
      { start: end - 3 * week, end: end - 2 * week, used: 100 },
      { start: end - 2 * week, end: end - week, used: 60 },
      { start: end - week, end, used: 20 },
    ];
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();

    // Read from the session the week began in.
    const since = (calls.find((c) => c.command === 'usage.history')!.request as { since: number })
      .since;
    expect(since).toBe(end - 7 * 24 * hour - 5 * hour);
    expect(texts('gr-usage-page .plan figcaption')).toEqual([
      'This session',
      'This week',
      'Sessions',
      'Weeks',
    ]);
    // The session is 3 hours of 5 gone; the week 4 days of 7.
    const meters = [...el.querySelectorAll('gr-usage-page .plan [role="meter"]')];
    expect(meters[0]!.getAttribute('aria-valuetext')).toBe('40% used, 60% of the session gone');
    expect(meters[1]!.getAttribute('aria-valuetext')).toBe('20% used, 57% of the week gone');
    expect(el.querySelectorAll('gr-usage-page .plan .pace')).toHaveLength(2);
    // One line each, so no legend; the even pace named by its end, and where the pace so far leads.
    expect(el.querySelector('gr-usage-page .plan .legend')).toBeNull();
    expect(texts('gr-usage-page .plan .guide-label')).toEqual(['even pace', 'even pace']);
    expect(el.querySelectorAll('gr-usage-page .plan path.guide')).toHaveLength(4);
    expect(el.querySelectorAll('gr-usage-page .plan path.area').length).toBeGreaterThan(0);
    expect(el.querySelector('gr-usage-page .plan gr-usage-lines .table-view')).toBeNull();
    expect(el.querySelector('gr-usage-page .plan .forecast')).toBeNull();
    expect(el.querySelectorAll('gr-usage-page .plan rect.session').length).toBeGreaterThan(0);
    // The two weeks ended, a dot each; the week under way is drawn above.
    const weeks = el.querySelectorAll('gr-usage-page .plan gr-usage-lines')[2]!;
    expect(weeks.querySelectorAll('circle.dot')).toHaveLength(2);
  });

  it('shows the limits the service read meanwhile in the Usage page, without reading them itself', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    answers['usage.plan'] = () => ({
      plan: 'max',
      windows: [{ span: 'session', used: 10, resetsAt: null }],
      at: now,
    });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Ledger')!
      .click();
    await fixture.whenStable();
    expect(texts('gr-usage-page .plan b')).toEqual(['10%']);

    emit('usage.read', {
      agent: 'claude-code',
      usage: { plan: 'max', windows: [{ span: 'session', used: 25, resetsAt: null }], at: now },
    });
    await fixture.whenStable();
    expect(texts('gr-usage-page .plan b')).toEqual(['25%']);
    expect(calls.filter((call) => call.command === 'usage.plan')).toHaveLength(1);
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
