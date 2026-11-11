import { TestBed } from '@angular/core/testing';
import { Settings } from '../core/settings';
import { useFakeBridge } from '../../testing/app-testing';
import { HeaderBadges } from './header-badges';
import { ShellRegistry } from './shell-registry';

describe('HeaderBadges', () => {
  it('stamps the registered badges in their tones, opening what they mark when they can', async () => {
    useFakeBridge();
    const open = vi.fn();
    const shell = TestBed.inject(ShellRegistry);
    shell.badges.add({
      id: 'review',
      label: 'Changes asked',
      tone: 'alert',
      detail: 'By Ann',
      open,
    });
    shell.badges.add({ id: 'ci', label: 'Checks pending', tone: 'quiet' });
    const fixture = TestBed.createComponent(HeaderBadges);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const [review, ci] = [...el.querySelectorAll<HTMLButtonElement>('.badge')];
    expect(el.getAttribute('aria-label')).toBe('Review stamps');
    expect(review!.textContent!.trim()).toBe('Changes asked');
    expect(review!.classList.contains('alert')).toBe(true);
    expect(review!.title).toBe('By Ann');
    expect(ci!.classList.contains('quiet')).toBe(true);
    expect(ci!.getAttribute('aria-disabled')).toBe('true');

    review!.click();
    ci!.click();
    expect(open).toHaveBeenCalledTimes(1);

    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(el.getAttribute('aria-label')).toBe('Review status');
  });

  it('stamps none when none is registered', async () => {
    useFakeBridge();
    const fixture = TestBed.createComponent(HeaderBadges);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.badge')).toHaveLength(0);
  });
});
