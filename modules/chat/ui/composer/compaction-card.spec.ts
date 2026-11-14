import type { CompactionSettings } from '@grimoire/contract';
import { fakeBridge, render, write } from '@ui/testing/app-testing';

const opus = 'claude-opus-5-5';
const compaction: CompactionSettings = {
  window: 400_000,
  min: 100_000,
  max: 1_000_000,
  reserve: 33_000,
};

/** The chat open, measured at `used` in a 400K window, with its compaction card open. */
async function opened(used = 50_000, settings: CompactionSettings | null = compaction) {
  const harness = fakeBridge();
  harness.answers['agents.compaction'] = () => settings;
  harness.answers['agents.setCompaction'] = () => undefined;
  const view = await render(harness.bridge);
  await write(view.fixture, view.el, 'Add the meter');
  harness.emit('agents.context', {
    chatId: 'chat-1',
    context: { used, limit: 400_000, compactsAt: 367_000, model: opus },
  });
  await view.fixture.whenStable();
  view.el.querySelector<HTMLButtonElement>('.allowance .gauge')!.click();
  await view.fixture.whenStable();
  const card = view.el.querySelector('gr-compaction-card')!;
  const slider = card.querySelector<HTMLInputElement>('input[type="range"]');
  return { ...harness, ...view, card, slider };
}

const changes = (calls: { command: string; request: unknown }[]) =>
  calls.filter((c) => c.command === 'agents.setCompaction').map((c) => c.request);

describe('compaction card', () => {
  it("shows the model's window on a slider snapping to round sizes, and where the chat is", async () => {
    const { card, slider, texts } = await opened();
    expect(texts('gr-compaction-card .reading')).toEqual(['400K · compacts at 367K']);
    expect(slider!.value).toBe('400000');
    expect([slider!.min, slider!.max, slider!.step]).toEqual(['100000', '1000000', '10000']);
    expect(texts('gr-compaction-card .stops span')).toEqual([
      '100K',
      '200K',
      '400K',
      '600K',
      '800K',
      '1M',
    ]);
    expect(card.querySelector<HTMLElement>('.now')!.style.left).toBe('0%');
    expect(texts('gr-compaction-card h2')).toEqual(['Page allowance for Opus 5.5']);
    expect(card.querySelector('[role="switch"], input[type="text"]')).toBeNull();
  });

  it('snaps as you drag, warns when the chat would compact at once, and saves as you let go', async () => {
    const { fixture, slider, texts, calls } = await opened(250_000);
    slider!.value = '272000';
    slider!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(slider!.value).toBe('270000');
    expect(texts('gr-compaction-card .reading')).toEqual(['270K · compacts at 237K']);
    expect(texts('gr-compaction-card .warn')).toEqual([
      'This chapter is summed up on its next turn.',
    ]);
    expect(changes(calls)).toEqual([]);
    expect(texts('gr-compaction-card .saved')).toEqual([]);
    slider!.value = '590000';
    slider!.dispatchEvent(new Event('input'));
    slider!.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(changes(calls)).toEqual([{ chatId: 'chat-1', change: { window: 600_000 } }]);
    expect(texts('gr-compaction-card .saved')).toEqual(['Saved']);
    slider!.value = '700000';
    slider!.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(texts('gr-compaction-card .saved')).toEqual([]);
  });

  it('leaves the window to the agent with Auto', async () => {
    const { fixture, card, texts, calls } = await opened();
    card.querySelector<HTMLButtonElement>('.auto')!.click();
    await fixture.whenStable();
    expect(card.querySelector('.auto')!.getAttribute('aria-pressed')).toBe('true');
    expect(texts('gr-compaction-card .reading')).toEqual([
      'Auto, Claude Code’s own · 400K, compacts at 367K',
    ]);
    expect(texts('gr-compaction-card .saved')).toEqual(['Saved']);
    expect(changes(calls)).toEqual([{ chatId: 'chat-1', change: { window: 'auto' } }]);
  });

  it('compacts the chat now', async () => {
    const { fixture, el, card, calls } = await opened();
    card.querySelector<HTMLButtonElement>('.foot button')!.click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'agents.send').map((c) => c.request)).toEqual([
      { chatId: 'chat-1', text: '/compact' },
    ]);
    expect(el.querySelector('gr-compaction-card')).toBeNull();
  });

  it("says when the agent can't change it, and closes on Esc", async () => {
    const { fixture, el, texts } = await opened(50_000, null);
    expect(texts('gr-compaction-card .reading')).toEqual([
      'This chapter’s allowance can’t be changed here yet.',
    ]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(el.querySelector('gr-compaction-card')).toBeNull();
  });
});
