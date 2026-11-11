import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageFooter } from './page-footer';

@Component({
  imports: [PageFooter],
  template: `<gr-page-footer><span>3 of 5 done</span></gr-page-footer>`,
})
class Host {}

describe('PageFooter', () => {
  it('holds the line put in it', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const footer = (fixture.nativeElement as HTMLElement).querySelector('gr-page-footer')!;
    expect(footer.textContent).toBe('3 of 5 done');
  });
});
