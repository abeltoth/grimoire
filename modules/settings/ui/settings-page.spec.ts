import { TestBed } from '@angular/core/testing';
import { Settings } from '@ui/app/core/settings';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('SettingsPage', () => {
  it('sets out the settings, the quick tasks, the presets, the theme and the profiles, in that order', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Colophon');
    const page = el.querySelector('gr-settings-page')!;
    expect([...page.children].map((child) => child.tagName.toLowerCase())).toEqual([
      'gr-general-settings',
      'gr-quick-model-settings',
      'gr-preset-settings',
      'section',
      'gr-profile-settings',
    ]);
    expect(texts('gr-settings-page #gr-settings-theme')).toEqual(['The theme']);
    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('gr-settings-page #gr-settings-theme')).toEqual(['Theme']);
  });
});
