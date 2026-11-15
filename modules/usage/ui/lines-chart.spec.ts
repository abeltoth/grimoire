import { TestBed } from '@angular/core/testing';
import { type LineSeries, UsageLines } from './lines-chart';

const texts = (el: HTMLElement, selector: string) =>
  [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());

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

describe('UsageLines guides', () => {
  it('draws dashed guides named in the legend, and no table when told not to', async () => {
    const fixture = TestBed.createComponent(UsageLines);
    fixture.componentRef.setInput('caption', 'The week');
    fixture.componentRef.setInput('series', [
      { name: 'This week', color: 'var(--gr-chart-1)', points: [{ at: 1_000, value: 10 }] },
    ]);
    fixture.componentRef.setInput('guides', [
      {
        name: 'Even pace',
        color: 'var(--gr-ink-soft)',
        from: { at: 0, value: 0 },
        to: { at: 4_000, value: 100 },
      },
    ]);
    fixture.componentRef.setInput('from', 0);
    fixture.componentRef.setInput('to', 4_000);
    fixture.componentRef.setInput('breakAfter', 1_500);
    fixture.componentRef.setInput('tabled', false);
    fixture.componentRef.setInput('when', (at: number) => `at ${at}`);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(texts(el, '.legend li')).toEqual(['This week', 'Even pace']);
    expect(el.querySelectorAll('path.guide')).toHaveLength(1);
    expect(el.querySelector('.table-view')).toBeNull();
  });
});
