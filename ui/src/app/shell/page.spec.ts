import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Page } from './page';

@Component({
  imports: [Page],
  template: `<gr-page [side]="side()" [alone]="alone()"><p>Text</p></gr-page>`,
})
class Host {
  readonly side = signal<'left' | 'right'>('left');
  readonly alone = signal(false);
}

describe('Page', () => {
  it('is a region holding its text, marked as the right page or the only one', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const page = (fixture.nativeElement as HTMLElement).querySelector('gr-page')!;
    expect(page.getAttribute('role')).toBe('region');
    expect(page.textContent).toBe('Text');
    expect(page.classList.contains('right-page')).toBe(false);

    fixture.componentInstance.side.set('right');
    fixture.componentInstance.alone.set(true);
    await fixture.whenStable();
    expect([...page.classList]).toEqual(expect.arrayContaining(['right-page', 'alone']));
  });
});
