import { TestBed } from '@angular/core/testing';
import { UsageAbout, aboutText } from './about-tip';

describe('UsageAbout', () => {
  const rows = [
    { head: 'Output', value: '5×', text: 'What Claude writes.' },
    { text: 'They overlap.' },
  ];

  it('tells each line in its tooltip, the figure in bold, and all of it to a screen reader', async () => {
    const fixture = TestBed.createComponent(UsageAbout);
    fixture.componentRef.setInput('rows', rows);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const about = el.querySelector('.about')!;
    expect(about.getAttribute('tabindex')).toBe('0');
    expect(about.getAttribute('aria-label')).toBe('Output, 5×: What Claude writes. They overlap.');
    expect(el.querySelector('.about-tip')).toBeNull();

    about.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(el.querySelector('.about-tip')!.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.about-head strong')!.textContent).toBe('5×');
    expect(
      [...el.querySelectorAll('.about-row')].map((row) =>
        row.textContent!.replace(/\s+/g, ' ').trim(),
      ),
    ).toEqual(['Output · 5×What Claude writes.', 'They overlap.']);

    about.dispatchEvent(new MouseEvent('mouseleave'));
    await fixture.whenStable();
    expect(el.querySelector('.about-tip')).toBeNull();
  });

  it('writes a line without a figure as its sentence alone', () => {
    expect(aboutText([{ head: 'Fresh input', text: 'Read anew.' }])).toBe(
      'Fresh input: Read anew.',
    );
  });
});
