import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PageHeader } from './page-header';

@Component({
  imports: [PageHeader],
  template: `<gr-page-header><div class="row">Title</div></gr-page-header>`,
})
class Host {}

describe('PageHeader', () => {
  it('holds the rows put in it', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const header = (fixture.nativeElement as HTMLElement).querySelector('gr-page-header')!;
    expect(header.querySelector('.row')!.textContent).toBe('Title');
  });
});
