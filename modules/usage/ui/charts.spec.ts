import { TestBed } from '@angular/core/testing';
import { type Column, niceTicks, UsageColumns } from './charts';

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

  it('adds a column’s note to its tooltip, and tells what the series mean behind an icon', async () => {
    const fixture = TestBed.createComponent(UsageColumns);
    fixture.componentRef.setInput('caption', 'Tokens by day');
    fixture.componentRef.setInput('about', 'Input: what goes in.');
    fixture.componentRef.setInput('series', [{ name: 'Input', color: 'var(--gr-chart-1)' }]);
    fixture.componentRef.setInput('columns', [
      { label: 'Mon', name: 'Monday', parts: [300], note: '$4.00 at API prices' },
    ]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('figcaption .about')!.getAttribute('title')).toBe(
      'Input: what goes in.',
    );
    expect(el.querySelector('figcaption gr-icon')).not.toBeNull();
    const hit = el.querySelector('rect.hit')!;
    expect(hit.getAttribute('aria-label')).toBe('Monday: 300; Input 300; $4.00 at API prices');
    hit.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(texts(el, '.tip-row')).toEqual(['$4.00 at API prices']);
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

  it('marks a value across the columns, named in the legend, and scales to reach it', async () => {
    const { fixture, el } = await columns(
      [{ name: 'Spent', color: 'var(--gr-chart-1)' }],
      [{ label: '1', name: 'Day 1', parts: [100] }],
    );
    fixture.componentRef.setInput('rule', { value: 450, label: '$4.50 a day' });
    await fixture.whenStable();
    expect(texts(el, '.legend li')).toEqual(['$4.50 a day']);
    expect(el.querySelector('svg .guide-label')).toBeNull();
    expect(el.querySelectorAll('line.rule')).toHaveLength(1);
    expect(texts(el, '.y-tick').at(-1)).toBe('600');
  });
});
