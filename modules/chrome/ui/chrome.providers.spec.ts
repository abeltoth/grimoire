import { TestBed } from '@angular/core/testing';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { fakeBridge, render } from '@ui/testing/app-testing';
import { ChromeSettings } from './chrome-settings';

describe('provideChrome', () => {
  it('adds its section to the Settings page', async () => {
    const { bridge } = fakeBridge();
    await render(bridge);
    const section = TestBed.inject(ShellRegistry).settingsSections.get('chrome')!;
    expect(await section.load()).toBe(ChromeSettings);
  });
});
