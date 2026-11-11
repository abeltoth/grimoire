import type { Profiles } from '@grimoire/contract';
import { fakeBridge, render } from '../../testing/app-testing';

const personal = { id: 'personal', name: 'Personal', claudeFolder: null };
const work = {
  id: 'work',
  name: 'Work',
  claudeFolder: 'C:/Users/me/AppData/Grimoire/profiles/work/claude',
};

function withProfiles() {
  const fake = fakeBridge();
  let list: Profiles = { active: 'personal', profiles: [personal, work] };
  fake.answers['profiles.list'] = () => list;
  fake.answers['profiles.switch'] = ({ id }: { id: string }) => {
    list = { ...list, active: id };
    fake.emit('profiles.changed', { profiles: list });
    return list;
  };
  return fake;
}

const button = (el: HTMLElement, scope: string, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find(
    (b) => b.textContent!.replace(/\s+/g, ' ').trim() === text,
  )!;

describe('TitleBar', () => {
  it('names the profile in use on the title bar, and switches from its menu', async () => {
    const { bridge, calls, emit } = withProfiles();
    const { fixture, el, texts } = await render(bridge);
    expect(texts('gr-title-bar .window-title')).toEqual(['Personal']);

    el.querySelector<HTMLButtonElement>('gr-title-bar .window-title')!.click();
    await fixture.whenStable();
    expect(texts('gr-title-bar [role="menu"] .item')).toEqual(['Personal', 'Work', 'Manage…']);
    expect(texts('gr-title-bar [aria-checked="true"]')).toEqual(['Personal']);

    button(el, 'gr-title-bar [role="menu"]', 'Work').click();
    await fixture.whenStable();
    expect(calls.filter((c) => c.command === 'profiles.switch')).toEqual([
      { command: 'profiles.switch', request: { id: 'work' } },
    ]);
    expect(el.querySelector('gr-title-bar [role="menu"]')).toBeNull();
    expect(texts('gr-title-bar .window-title')).toEqual(['Work']);

    // Another window switched, or renamed it.
    emit('profiles.changed', {
      profiles: { active: 'work', profiles: [personal, { ...work, name: 'Office' }] },
    });
    await fixture.whenStable();
    expect(texts('gr-title-bar .window-title')).toEqual(['Office']);
  });

  it('says why a switch was refused', async () => {
    const { bridge, answers } = withProfiles();
    answers['profiles.switch'] = () => {
      throw new Error(
        'Can’t switch to "Work" yet. Wait for "Fix the ribbon" to finish, or stop it, first',
      );
    };
    const { fixture, el, texts } = await render(bridge);
    el.querySelector<HTMLButtonElement>('gr-title-bar .window-title')!.click();
    await fixture.whenStable();
    button(el, 'gr-title-bar [role="menu"]', 'Work').click();
    await fixture.whenStable();

    expect(texts('gr-title-bar [role="alert"]')).toEqual([
      'Can’t switch to "Work" yet. Wait for "Fix the ribbon" to finish, or stop it, first Dismiss',
    ]);
    expect(texts('gr-title-bar .window-title')).toEqual(['Personal']);
    button(el, 'gr-title-bar [role="alert"]', 'Dismiss').click();
    await fixture.whenStable();
    expect(el.querySelector('gr-title-bar [role="alert"]')).toBeNull();
  });
});
