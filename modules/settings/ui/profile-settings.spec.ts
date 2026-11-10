import type { AgentSignIn, Profiles } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-harness';

describe('profile-settings', () => {
  describe('profiles', () => {
    const personal = { id: 'personal', name: 'Personal', claudeFolder: null };
    const work = {
      id: 'work',
      name: 'Work',
      claudeFolder: 'C:/Users/me/AppData/Grimoire/profiles/work/claude',
    };

    function withProfiles(active = 'personal') {
      const fake = fakeBridge();
      let list: Profiles = { active, profiles: [personal, work] };
      fake.answers['profiles.list'] = () => list;
      fake.answers['profiles.switch'] = ({ id }: { id: string }) => {
        list = { ...list, active: id };
        fake.emit('profiles.changed', { profiles: list });
        return list;
      };
      fake.answers['profiles.create'] = ({ name }: { name: string }) => {
        const made = {
          id: name.toLowerCase(),
          name,
          claudeFolder: `C:/Users/me/AppData/Grimoire/profiles/${name.toLowerCase()}/claude`,
        };
        list = { ...list, profiles: [...list.profiles, made] };
        return list;
      };
      fake.answers['profiles.rename'] = ({ id, name }: { id: string; name: string }) => {
        list = { ...list, profiles: list.profiles.map((p) => (p.id === id ? { ...p, name } : p)) };
        return list;
      };
      return fake;
    }

    const openSettings = async (el: HTMLElement, fixture: { whenStable(): Promise<unknown> }) => {
      [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
        .find((tab) => tab.textContent!.trim() === 'Colophon')!
        .click();
      await fixture.whenStable();
    };
    const button = (el: HTMLElement, scope: string, text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>(`${scope} button`)].find(
        (b) => b.textContent!.replace(/\s+/g, ' ').trim() === text,
      )!;

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

    it('opens the profiles in Settings from the menu, to make, rename and delete them', async () => {
      const { bridge, calls } = withProfiles('work');
      const { fixture, el, texts } = await render(bridge);
      el.querySelector<HTMLButtonElement>('gr-title-bar .window-title')!.click();
      await fixture.whenStable();
      button(el, 'gr-title-bar [role="menu"]', 'Manage…').click();
      await fixture.whenStable();

      expect(texts('gr-tab-page .title')).toEqual(['Colophon']);
      const section = 'section[aria-labelledby="gr-settings-profiles"]';
      expect(texts(`${section} h2`)).toEqual(['Volumes']);
      expect(texts(`${section} h3`)).toEqual(['Personal', 'Work open now']);
      expect(texts(`${section} .sub code`)).toEqual([
        '~/.claude',
        '~/AppData/Grimoire/profiles/work/claude',
      ]);
      // Neither Personal nor the profile in use can be deleted.
      const deletes = () =>
        [...el.querySelectorAll<HTMLButtonElement>(`${section} .profile .actions button`)]
          .filter((b) => b.textContent!.trim() === 'Delete')
          .map((b) => b.disabled);
      expect(deletes()).toEqual([true, true]);

      // A new profile, which asks to be signed in.
      button(el, section, 'New volume').click();
      await fixture.whenStable();
      const field = el.querySelector<HTMLInputElement>(`${section} .profile-field`)!;
      field.value = 'Side';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'profiles.create')).toEqual([
        { command: 'profiles.create', request: { name: 'Side' } },
      ]);
      expect(texts(`${section} h3`)).toEqual(['Personal', 'Work open now', 'Side']);
      expect(texts(`${section} [role="status"]`)).toEqual([
        'Not signed in yet: Claude Code signs in afresh in its Claude folder. Open it and sign in',
      ]);
      expect(deletes()).toEqual([true, true, false]);

      // Renamed in place.
      const renames = [
        ...el.querySelectorAll<HTMLButtonElement>(`${section} .profile .actions button`),
      ].filter((b) => b.textContent!.trim() === 'Rename');
      renames[2]!.click();
      await fixture.whenStable();
      const name = el.querySelector<HTMLInputElement>(`${section} .name-field`)!;
      name.value = 'Side project';
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'profiles.rename')).toEqual([
        { command: 'profiles.rename', request: { id: 'side', name: 'Side project' } },
      ]);
      expect(texts(`${section} h3`)).toEqual(['Personal', 'Work open now', 'Side project']);

      // Deleting says where the Claude folder stays.
      const lastDelete = [
        ...el.querySelectorAll<HTMLButtonElement>(`${section} .profile .actions button`),
      ]
        .filter((b) => b.textContent!.trim() === 'Delete')
        .at(-1)!;
      lastDelete.click();
      await fixture.whenStable();
      expect(texts(`${section} .ask`)).toEqual([
        'Delete “Side project”? Its settings, presets and scheduled chats go. Its Claude folder, with its chapters, stays at C:/Users/me/AppData/Grimoire/profiles/side/claude.',
      ]);
    });

    it('switches to a new profile to sign it in, then asks for the account once the window is back', async () => {
      const { bridge, answers, calls } = withProfiles();
      answers['agents.list'] = () => [
        { id: 'claude-code', name: 'Claude Code', capabilities: ['sign-in'] },
      ];
      answers['agents.account'] = (): AgentSignIn => ({
        agent: 'claude-code',
        account: null,
        pending: null,
      });
      const { fixture, el, texts } = await render(bridge);
      await openSettings(el, fixture);
      const section = 'section[aria-labelledby="gr-settings-profiles"]';
      button(el, section, 'New volume').click();
      await fixture.whenStable();
      const field = el.querySelector<HTMLInputElement>(`${section} .profile-field`)!;
      field.value = 'Side';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      await fixture.whenStable();
      button(el, section, 'Open it and sign in').click();
      await fixture.whenStable();
      expect(calls.filter((c) => c.command === 'profiles.switch')).toEqual([
        { command: 'profiles.switch', request: { id: 'side' } },
      ]);
      // The window opens again on the new profile, kept in mind across the reload.
      expect(sessionStorage.getItem('grimoire.signInNext')).toBe('side');
      sessionStorage.removeItem('grimoire.signInNext');
      expect(texts('gr-title-bar .window-title')).toEqual(['Side']);
    });

    it('opens Settings on the account to sign in as, after switching to sign in', async () => {
      const { bridge, answers } = withProfiles('work');
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

    it('lists the other profiles in the command palette, in the book’s words or plainly', async () => {
      const { bridge, emit } = withProfiles();
      const { fixture, texts } = await render(bridge);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      await fixture.whenStable();
      expect(texts('gr-command-palette .entry .label')).toContain('Open the Work volume');
      expect(texts('gr-command-palette .entry .label')).not.toContain('Open the Personal volume');

      emit('settings.changed', { settings: { ...DEFAULT_SETTINGS, wording: 'plain' } });
      await fixture.whenStable();
      expect(texts('gr-command-palette .entry .label')).toContain('Switch to Work');
    });
  });
});
