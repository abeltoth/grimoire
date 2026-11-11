import { TestBed } from '@angular/core/testing';
import { Icon, type IconName } from './icon';

const NAMES: IconName[] = [
  'quill',
  'bell',
  'circle',
  'moon',
  'page',
  'plus',
  'branch',
  'chevron-down',
  'single-page',
  'two-pages',
  'minimize',
  'maximize',
  'close',
  'pen',
  'pop-out',
  'attach',
  'parallel',
  'hourglass',
  'approval',
  'tick',
  'check',
  'ornament',
];

describe('Icon', () => {
  it('draws every icon it names, hidden from screen readers', async () => {
    for (const name of NAMES) {
      const fixture = TestBed.createComponent(Icon);
      fixture.componentRef.setInput('name', name);
      await fixture.whenStable();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('svg'), name).not.toBeNull();
      expect(el.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
