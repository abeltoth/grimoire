import { TestBed } from '@angular/core/testing';
import { type LineSeries, UsageLines, smoothPath } from './lines-chart';

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
  it('draws dashed guides named by their ends, a dot on each reading and the ground shaded, and no table when told not to', async () => {
    const fixture = TestBed.createComponent(UsageLines);
    fixture.componentRef.setInput('caption', 'The week');
    fixture.componentRef.setInput('series', [
      {
        name: 'This week',
        color: 'var(--gr-chart-1)',
        points: [
          { at: 1_000, value: 10 },
          { at: 2_000, value: 15 },
          { at: 3_000, value: 20 },
        ],
      },
    ]);
    fixture.componentRef.setInput('guides', [
      {
        name: 'Even pace',
        label: 'even pace',
        color: 'var(--gr-ink-soft)',
        from: { at: 0, value: 0 },
        to: { at: 4_000, value: 100 },
      },
    ]);
    fixture.componentRef.setInput('from', 0);
    fixture.componentRef.setInput('to', 4_000);
    fixture.componentRef.setInput('breakAfter', 1_500);
    fixture.componentRef.setInput('tabled', false);
    fixture.componentRef.setInput('dots', true);
    fixture.componentRef.setInput('area', true);
    fixture.componentRef.setInput('when', (at: number) => `at ${at}`);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('.legend')).toBeNull();
    expect(texts(el, '.guide-label')).toEqual(['even pace']);
    expect(el.querySelectorAll('path.guide')).toHaveLength(1);
    expect(el.querySelectorAll('path.area')).toHaveLength(1);
    expect(el.querySelectorAll('circle.dot')).toHaveLength(3);
    expect(el.querySelector('.table-view')).toBeNull();
  });

  it('writes a line’s latest value above and before its end when a guide leads on from there, past it otherwise', async () => {
    const fixture = TestBed.createComponent(UsageLines);
    const end = { at: 2_000, value: 20 };
    fixture.componentRef.setInput('caption', 'The session');
    fixture.componentRef.setInput('series', [
      { name: 'This session', color: 'var(--gr-chart-1)', points: [{ at: 1_000, value: 10 }, end] },
    ]);
    fixture.componentRef.setInput('from', 0);
    fixture.componentRef.setInput('to', 4_000);
    fixture.componentRef.setInput('breakAfter', 1_500);
    fixture.componentRef.setInput('when', (at: number) => `at ${at}`);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const label = () => el.querySelector('.end-label')!;
    expect(label().getAttribute('text-anchor')).toBe('start');

    fixture.componentRef.setInput('guides', [
      { name: 'At this rate', color: 'var(--gr-chart-1)', from: end, to: { at: 4_000, value: 30 } },
    ]);
    await fixture.whenStable();
    expect(label().getAttribute('text-anchor')).toBe('end');
    expect(texts(el, '.end-label')).toEqual(['20%']);
  });
});

describe('smoothPath', () => {
  it('curves through every point, flat where the line holds, so it never rises past one', () => {
    const d = smoothPath([
      { x: 0, y: 100 },
      { x: 10, y: 50 },
      { x: 20, y: 50 },
      { x: 30, y: 0 },
    ]);
    expect(d).toMatch(/^M0\.0,100\.0C/);
    // Each control point lies between its segment's ends.
    const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    // Holding at 50, the curve leaves the second point flat.
    expect(d).toContain('C13.3,50.0 16.7,50.0 20.0,50.0');
    expect(
      smoothPath([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]),
    ).toBe('M0.0,0.0L5.0,5.0');
  });
});
