import type { GrimoireSettings } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

/** The app on the Settings page, the settings kept by a fake service. */
async function onSettings(start: Partial<GrimoireSettings> = {}) {
  const fake = fakeBridge();
  let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, ...start };
  fake.answers['settings.get'] = () => kept;
  fake.answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
    (kept = { ...kept, ...change });
  const app = await render(fake.bridge);
  [...app.el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
    .find((tab) => tab.textContent!.trim() === 'Colophon')!
    .click();
  await app.fixture.whenStable();
  const sets = () => fake.calls.filter((c) => c.command === 'settings.set').map((c) => c.request);
  const change = async (selector: string, value: string) => {
    const field = app.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('change'));
    await app.fixture.whenStable();
    return field;
  };
  return { ...fake, ...app, sets, change };
}

describe('JiraSettings', () => {
  it('lists Jira’s settings in a section of their own', async () => {
    const { texts } = await onSettings();
    expect(texts('gr-jira-settings h2')).toEqual(['Jira']);
    expect(texts('gr-jira-settings .label')).toEqual([
      'Jira',
      'Jira query',
      'New issues go in',
      'New issues are a',
    ]);
    expect(texts('gr-jira-settings .word[aria-checked="true"]')).toEqual(['On']);
  });

  it('keeps the query written, and the one the board began with when it’s emptied', async () => {
    const { change, sets } = await onSettings();
    await change('#gr-settings-jira', ' project = GRIM ');
    const field = await change('#gr-settings-jira', ' ');
    expect(sets()).toEqual([
      { jiraQuery: 'project = GRIM' },
      { jiraQuery: DEFAULT_SETTINGS.jiraQuery },
    ]);
    expect(field.value).toBe(DEFAULT_SETTINGS.jiraQuery);
  });

  it('keeps the project new issues go in, in capitals, and the type they are', async () => {
    const { change, sets } = await onSettings();
    await change('#gr-settings-jira-project', ' grim ');
    const wrong = await change('#gr-settings-jira-project', 'not a key');
    expect(wrong.value).toBe('GRIM');
    await change('#gr-settings-jira-type', 'Story');
    const emptied = await change('#gr-settings-jira-type', ' ');
    expect(emptied.value).toBe('Task');
    expect(sets()).toEqual([
      { jiraProject: 'GRIM' },
      { jiraIssueType: 'Story' },
      { jiraIssueType: 'Task' },
    ]);
  });

  it('turns Jira off, which hides the rest', async () => {
    const { el, fixture, sets, texts } = await onSettings();
    [...el.querySelectorAll<HTMLButtonElement>('[aria-labelledby="gr-settings-jira-on"] .word')]
      .find((button) => button.textContent!.trim() === 'Off')!
      .click();
    await fixture.whenStable();
    expect(sets()).toEqual([{ jira: false }]);
    expect(texts('gr-jira-settings .label')).toEqual(['Jira']);
  });
});
