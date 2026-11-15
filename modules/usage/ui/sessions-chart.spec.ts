import { TestBed } from '@angular/core/testing';
import { UsageSessions } from './sessions-chart';
import { time } from './usage-format';

const HOUR = 60 * 60_000;

describe('UsageSessions', () => {
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();

  it('draws a row a day, splits a session at midnight, and marks where one ran out', async () => {
    const fixture = TestBed.createComponent(UsageSessions);
    fixture.componentRef.setInput('caption', 'Each session');
    fixture.componentRef.setInput('from', at(5, 15));
    fixture.componentRef.setInput('now', at(7, 12));
    fixture.componentRef.setInput('sessions', [
      { start: at(5, 22), end: at(5, 22) + 5 * HOUR, peak: 100, fullAt: at(6, 1) },
      { start: at(7, 9), end: at(7, 14), peak: 30, fullAt: null },
    ]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('rect.day')).toHaveLength(3);
    const blocks = [...el.querySelectorAll('rect.session')];
    expect(blocks).toHaveLength(3);
    // The fuller, the darker.
    expect(Number(blocks[0]!.getAttribute('fill-opacity'))).toBe(1);
    expect(Number(blocks[2]!.getAttribute('fill-opacity'))).toBeLessThan(1);
    expect(blocks[2]!.getAttribute('aria-label')).toMatch(/: peaked at 30%$/);
    expect(blocks[0]!.getAttribute('aria-label')).toMatch(
      new RegExp(`peaked at 100%, ran out at ${time(at(6, 1))}$`),
    );
    expect(el.querySelectorAll('line.ran-out')).toHaveLength(1);

    blocks[2]!.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(el.querySelector('.tip')!.textContent).toMatch(/peaked at 30%/);
    expect(el.querySelectorAll('rect.session.dim')).toHaveLength(2);
    blocks[2]!.dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    expect(el.querySelector('.tip')).toBeNull();
  });
});
