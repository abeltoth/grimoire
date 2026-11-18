import { TestBed } from '@angular/core/testing';
import { useFakeBridge } from '@ui/testing/app-testing';
import { TokenReadings } from './token-readings';
import { UsageSpans } from './usage-spans';

describe('UsageSpans', () => {
  it('shows a span when picked, and reads again when asked', async () => {
    useFakeBridge();
    TestBed.configureTestingModule({ providers: [TokenReadings] });
    const readings = TestBed.inject(TokenReadings);
    const showSpan = vi.spyOn(readings, 'showSpan');
    const read = vi.spyOn(readings, 'read');
    const fixture = TestBed.createComponent(UsageSpans);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = [...el.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent!.trim())).toEqual([
      'Last 24 hours',
      'Last 7 days',
      'Read again',
    ]);
    expect(el.querySelector('[aria-checked="true"]')!.textContent!.trim()).toBe('Last 7 days');

    buttons[0]!.click();
    buttons[2]!.click();
    expect(showSpan).toHaveBeenCalledWith('day');
    expect(read).toHaveBeenCalled();
  });
});
