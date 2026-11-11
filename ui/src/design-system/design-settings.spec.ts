import { TestBed } from '@angular/core/testing';
import { DesignSettings } from './design-settings';

describe('DesignSettings', () => {
  const root = document.documentElement;

  it('marks the document when drawings are turned off and on', async () => {
    const settings = TestBed.inject(DesignSettings);
    TestBed.tick();
    expect(root.dataset['drawings']).toBe('on');
    settings.drawings.set(false);
    TestBed.tick();
    expect(root.dataset['drawings']).toBe('off');
  });

  it('marks the theme in use, auto being light where the system says nothing', () => {
    const settings = TestBed.inject(DesignSettings);
    settings.themeName.set('night');
    TestBed.tick();
    expect(root.dataset['theme']).toBe('night');
    settings.themeName.set('auto');
    TestBed.tick();
    expect(settings.theme()).toBe('grimoire');
    expect(root.dataset['theme']).toBe('grimoire');
  });

  it('sets the changed tokens over the theme’s, and takes away those no longer changed', () => {
    const settings = TestBed.inject(DesignSettings);
    settings.tokens.set({ '--gr-page': '#fffaf0', '--gr-ink': '#111111' });
    TestBed.tick();
    expect(root.style.getPropertyValue('--gr-page')).toBe('#fffaf0');
    settings.tokens.set({ '--gr-ink': '#222222' });
    TestBed.tick();
    expect(root.style.getPropertyValue('--gr-page')).toBe('');
    expect(root.style.getPropertyValue('--gr-ink')).toBe('#222222');

    TestBed.resetTestingModule();
    expect(root.style.getPropertyValue('--gr-ink')).toBe('');
    expect(root.dataset['theme']).toBeUndefined();
  });
});
