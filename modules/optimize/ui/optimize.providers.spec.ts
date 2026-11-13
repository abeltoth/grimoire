import { TestBed } from '@angular/core/testing';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { fakeBridge, render } from '@ui/testing/app-testing';
import { OptimizeSettings } from './optimize-settings';

describe('provideOptimize', () => {
  it('adds its section to the Settings page', async () => {
    const { bridge, answers } = fakeBridge();
    answers['agents.commands'] = () => [];
    await render(bridge);
    expect(TestBed.inject(ShellRegistry).settingsSections.get('optimize')?.component).toBe(
      OptimizeSettings,
    );
  });
});
