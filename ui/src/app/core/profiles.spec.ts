import { TestBed } from '@angular/core/testing';
import type { Profiles as ProfileList } from '@grimoire/contract';
import { useFakeBridge } from '../../testing/app-testing';
import { Profiles } from './profiles';

const listed = (active: string, ...ids: string[]): ProfileList => ({
  active,
  profiles: ids.map((id) => ({ id, name: id, claudeFolder: null })),
});

async function withProfiles() {
  const fake = useFakeBridge();
  fake.answers['profiles.list'] = () => listed('personal', 'personal', 'work');
  const profiles = TestBed.inject(Profiles);
  await profiles.load();
  return { ...fake, profiles };
}

describe('Profiles', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('names the profile in use and the others, and follows the service', async () => {
    const { profiles, emit } = await withProfiles();
    expect(profiles.active()?.id).toBe('personal');
    expect(profiles.others().map(({ id }) => id)).toEqual(['work']);
    emit('profiles.changed', { profiles: listed('work', 'personal', 'work') });
    expect(profiles.active()?.id).toBe('work');
  });

  it('makes a profile and gives it back, or says why it couldn’t', async () => {
    const { profiles, answers } = await withProfiles();
    answers['profiles.create'] = () => listed('personal', 'personal', 'work', 'club');
    expect((await profiles.create('club'))?.id).toBe('club');

    answers['profiles.rename'] = () => Promise.reject(new Error('That name is taken'));
    expect(await profiles.rename('club', 'work')).toBe(false);
    expect(profiles.failed()).toBe('That name is taken');
  });

  it('switches once at a time, and not to the one in use; a refusal says why', async () => {
    const { profiles, answers, calls } = await withProfiles();
    expect(await profiles.switch('personal')).toBe(false);
    answers['profiles.switch'] = () => Promise.reject(new Error('A chat is being written'));
    expect(await profiles.switch('work')).toBe(false);
    expect(profiles.refused()).toBe('A chat is being written');
    expect(profiles.switching()).toBeNull();
    expect(calls.filter((c) => c.command === 'profiles.switch')).toHaveLength(1);
  });

  it('asks for the account once the window is back on the profile switched to to sign in', async () => {
    const { profiles, answers } = await withProfiles();
    answers['profiles.switch'] = () => Promise.reject(new Error('A chat is being written'));
    await profiles.switchToSignIn('work');
    expect(sessionStorage.getItem('grimoire.signInNext')).toBeNull();

    answers['profiles.switch'] = () => listed('work', 'personal', 'work');
    await profiles.switchToSignIn('work');
    expect(sessionStorage.getItem('grimoire.signInNext')).toBe('work');
    answers['profiles.list'] = () => listed('work', 'personal', 'work');
    await profiles.load();
    expect(profiles.signInNext()).toBe(true);
    expect(sessionStorage.getItem('grimoire.signInNext')).toBeNull();
  });
});
