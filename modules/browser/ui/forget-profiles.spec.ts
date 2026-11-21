import { TestBed } from '@angular/core/testing';
import { Profiles } from '@ui/app/core/profiles';
import { fakeBrowserViews, fakeBridge, render } from '@ui/testing/app-testing';

describe('forgetRemovedProfiles', () => {
  it('deletes what a deleted profile’s web pages kept', async () => {
    const browser = fakeBrowserViews();
    const { bridge } = fakeBridge({ browser: browser.views });
    const { fixture } = await render(bridge);
    const profiles = TestBed.inject(Profiles);
    const work = { id: 'work', name: 'Work', claudeFolder: null };
    const personal = { id: 'personal', name: 'Personal', claudeFolder: null };
    profiles.list.set({ active: 'personal', profiles: [personal, work] });
    await fixture.whenStable();
    expect(browser.views.forget).not.toHaveBeenCalled();
    profiles.list.set({ active: 'personal', profiles: [personal] });
    await fixture.whenStable();
    expect(browser.views.forget).toHaveBeenCalledWith('work');
  });
});
