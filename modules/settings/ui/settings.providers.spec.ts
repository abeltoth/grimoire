import { TestBed } from '@angular/core/testing';
import {
  type AgentSignIn,
  DEFAULT_SETTINGS,
  type GrimoireSettings,
  SCALES,
} from '@grimoire/contract';
import { Settings } from '@ui/app/core/settings';
import { fakeBridge, openPageTab, render } from '@ui/testing/app-testing';

describe('settings.providers', () => {
  it('adds the Colophon page tab, which turns the right page to the settings', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await openPageTab(fixture, el, 'Colophon');
    expect(el.querySelector('gr-settings-page')).not.toBeNull();
    TestBed.inject(Settings).all.update((all) => ({ ...all, wording: 'plain' }));
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Settings']);
  });

  it('zooms every window in and out with the keyboard, within the range, and back', async () => {
    const { bridge, answers } = fakeBridge();
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
      (kept = { ...kept, ...change });
    const { fixture } = await render(bridge);
    const press = async (key: string) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
      await fixture.whenStable();
    };
    await press('=');
    await press('=');
    expect(kept.scale).toBe(1.2);
    expect(bridge.zoom).toHaveBeenLastCalledWith(1.2);
    await press('-');
    expect(kept.scale).toBe(1.1);
    for (let i = 0; i < 10; i++) await press('-');
    expect(kept.scale).toBe(SCALES.min);
    await press('0');
    expect(kept.scale).toBe(1);
  });

  it('opens Settings on the account to sign in as, after switching to sign in', async () => {
    const { bridge, answers } = fakeBridge();
    answers['profiles.list'] = () => ({
      active: 'work',
      profiles: [
        { id: 'personal', name: 'Personal', claudeFolder: null },
        {
          id: 'work',
          name: 'Work',
          claudeFolder: 'C:/Users/me/AppData/Grimoire/profiles/work/claude',
        },
      ],
    });
    answers['agents.list'] = () => [
      { id: 'claude-code', name: 'Claude Code', capabilities: ['sign-in'] },
    ];
    answers['agents.account'] = (): AgentSignIn => ({
      agent: 'claude-code',
      account: null,
      pending: null,
    });
    sessionStorage.setItem('grimoire.signInNext', 'work');
    const { fixture, el, texts } = await render(bridge);
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-tab-page .title')).toEqual(['Colophon']);
    expect(document.activeElement).toBe(el.querySelector('gr-settings-page .account-field'));
    expect(sessionStorage.getItem('grimoire.signInNext')).toBeNull();
  });
});
