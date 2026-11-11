import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Frame } from './frame';

@Component({
  imports: [Frame],
  template: `<gr-frame [bare]="bare()" [single]="single()"><p>Leaves</p></gr-frame>`,
})
class Host {
  readonly bare = signal(false);
  readonly single = signal(false);
}

describe('Frame', () => {
  it('holds the pages in its spread, with the spine ornament on the cover', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const frame = (fixture.nativeElement as HTMLElement).querySelector('gr-frame')!;
    expect(frame.querySelector('.spread p')!.textContent).toBe('Leaves');
    expect(frame.querySelector('gr-drawing.ornament')).not.toBeNull();
    expect(frame.classList.contains('bare')).toBe(false);
  });

  it('lies out of its cover, with no ornament, and on a single page', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.bare.set(true);
    fixture.componentInstance.single.set(true);
    await fixture.whenStable();
    const frame = (fixture.nativeElement as HTMLElement).querySelector('gr-frame')!;
    expect(frame.querySelector('gr-drawing')).toBeNull();
    expect([...frame.classList]).toEqual(expect.arrayContaining(['bare', 'single']));
  });
});
