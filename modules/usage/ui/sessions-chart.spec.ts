import { TestBed } from '@angular/core/testing';
import { UsageSessions } from './sessions-chart';
import { time, weekday } from './usage-format';

const HOUR = 60 * 60_000;

describe('UsageSessions', () => {
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();

  it('draws a row a day, splits a session at midnight, and names each by when it ran', async () => {
    const fixture = TestBed.createComponent(UsageSessions);
    fixture.componentRef.setInput('caption', 'Each session');
    fixture.componentRef.setInput('from', at(5, 15));
    fixture.componentRef.setInput('now', at(7, 12));
    fixture.componentRef.setInput('sessions', [
      { start: at(5, 22), end: at(5, 22) + 3 * HOUR },
      { start: at(7, 9), end: at(7, 11) },
    ]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelectorAll('rect.day')).toHaveLength(3);
    const blocks = [...el.querySelectorAll('rect.session')];
    expect(blocks).toHaveLength(3);
    expect(blocks[2]!.getAttribute('aria-label')).toBe(
      `${weekday(at(7, 9))} ${time(at(7, 9))} to ${time(at(7, 11))}`,
    );
    expect(el.querySelector('line.ran-out')).toBeNull();

    blocks[2]!.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(el.querySelector('.tip')!.textContent).toContain(time(at(7, 11)));
    expect(el.querySelectorAll('rect.session.dim')).toHaveLength(2);
    blocks[2]!.dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    expect(el.querySelector('.tip')).toBeNull();
  });
});
