import { TestBed } from '@angular/core/testing';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { fakeBridge, render } from '@ui/testing/app-testing';
import { LabelSettings } from './label-settings';

describe('provideAutoLabels', () => {
  it('adds its section to the Settings page', async () => {
    const { bridge } = fakeBridge();
    await render(bridge);
    const section = TestBed.inject(ShellRegistry).settingsSections.get('labels')!;
    expect(await section.load()).toBe(LabelSettings);
  });
});
