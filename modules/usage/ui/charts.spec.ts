import { TestBed } from '@angular/core/testing';
import { type Column, type LineSeries, niceTicks, UsageColumns, UsageLines } from './charts';

const texts = (el: HTMLElement, selector: string) =>
  [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());

describe('niceTicks', () => {
  it('steps from 0 past the largest value by 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(1_400)).toEqual([0, 500, 1_000, 1_500]);
  });
});

describe('UsageColumns', () => {
  async function columns(series: { name: string; color: string }[], shown: Column[]) {
    const fixture = TestBed.createComponent(UsageColumns);
    fixture.componentRef.setInput('caption', 'Tokens by day');
    fixture.componentRef.setInput('series', series);
    fixture.componentRef.setInput('columns', shown);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows a column’s total and its parts in the tooltip on hover, and hides it on leaving', async () => {
    const { fixture, el } = await columns(
      [
        { name: 'Input', color: 'var(--gr-chart-1)' },
        { name: 'Output', color: 'var(--gr-chart-2)' },
      ],
      [
        { label: 'Mon', name: 'Monday', parts: [300, 0] },
        { label: 'Tue', name: 'Tuesday', parts: [600, 500] },
      ],
    );
    expect(texts(el, '.legend li')).toEqual(['Input', 'Output']);
    const hits = el.querySelectorAll('rect.hit');
    expect(hits[1]!.getAttribute('aria-label')).toBe('Tuesday: 1,100; Input 600, Output 500');

    hits[1]!.dispatchEvent(new MouseEvent('mouseenter'));
    await fixture.whenStable();
    expect(texts(el, '.tip strong')).toEqual(['1,100', '600', '500']);
    expect(el.querySelectorAll('g.column.dim')).toHaveLength(1);

    el.querySelector('svg')!.dispatchEvent(new MouseEvent('mouseleave'));
    await fixture.whenStable();
    expect(el.querySelector('.tip')).toBeNull();
  });

  it('names one series in the caption alone, with no legend, and its total in the tooltip', async () => {
    const { fixture, el } = await columns(
      [{ name: 'Peak', color: 'var(--gr-chart-1)' }],
      [{ label: '', name: 'Session', parts: [60] }],
    );
    expect(el.querySelector('.legend')).toBeNull();
    el.querySelector('rect.hit')!.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(texts(el, '.tip strong')).toEqual(['60']);
  });
});

describe('UsageLines', () => {
  it('puts the crosshair on the latest reading on focus, and the arrow keys step through them', async () => {
    const series: LineSeries[] = [
      {
        name: 'This week',
        color: 'var(--gr-chart-1)',
        points: [
          { at: 1_000, value: 10 },
          { at: 2_000, value: 15 },
          { at: 3_000, value: 20 },
        ],
      },
    ];
    const fixture = TestBed.createComponent(UsageLines);
    fixture.componentRef.setInput('caption', 'The week');
    fixture.componentRef.setInput('series', series);
    fixture.componentRef.setInput('from', 0);
    fixture.componentRef.setInput('to', 4_000);
    fixture.componentRef.setInput('breakAfter', 1_500);
    fixture.componentRef.setInput('when', (at: number) => `at ${at}`);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const plot = el.querySelector<SVGRectElement>('rect.hit')!;

    plot.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(texts(el, '.tip strong')).toEqual(['20%']);
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await fixture.whenStable();
    expect(texts(el, '.tip strong')).toEqual(['15%']);
    expect(plot.getAttribute('aria-label')).toBe('at 2000: This week 15%');
    plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    await fixture.whenStable();
    expect(texts(el, '.tip strong')).toEqual(['10%']);

    plot.dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    expect(el.querySelector('.tip')).toBeNull();
  });
});
