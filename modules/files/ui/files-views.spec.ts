import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { repository } from './files-testing';
import { FilesViews, MOST_TABS } from './files-views';

describe('FilesViews', () => {
  async function withViews() {
    const fake = repository();
    TestBed.configureTestingModule({
      providers: [{ provide: GRIMOIRE_BRIDGE, useValue: fake.bridge }],
    });
    const views = TestBed.inject(FilesViews);
    const view = views.of('C:/Users/me');
    await views.read(view);
    return { ...fake, views, view };
  }

  it('keeps one view a folder, as you left it', async () => {
    const { views, view } = await withViews();
    expect(views.of('C:/Users/me')).toBe(view);
    expect(views.of('C:/Users/me/git/other')).not.toBe(view);
  });

  it('reads a file open again when it changes on disk', async () => {
    const { views, view, emit, disk } = await withViews();
    await views.open(view, 'README.md');
    const tab = view.active()!;

    disk['README.md'] = { path: 'README.md', text: '# Grimoire, by the agent\n', changedAt: 3 };
    emit('files.changed', { root: 'C:/Users/me/git/grimoire', path: 'README.md' });
    await TestBed.inject(ApplicationRef).whenStable();
    expect(tab.draft()).toBe('# Grimoire, by the agent\n');
    expect(tab.changed()).toBe(false);
    expect(tab.onDisk()).toBeNull();
    expect(tab.note()).toEqual({ text: 'It changed on disk, and was read again.' });

    // Another folder's file of the same name isn't this one.
    disk['README.md'] = { path: 'README.md', text: '# Elsewhere\n', changedAt: 4 };
    emit('files.changed', { root: 'C:/Users/me/git/other', path: 'README.md' });
    await TestBed.inject(ApplicationRef).whenStable();
    expect(tab.draft()).toBe('# Grimoire, by the agent\n');
  });

  it('keeps your changes when the file changes on disk under them, for you to choose', async () => {
    const { views, view, emit, disk } = await withViews();
    const changeOnDisk = async (text: string, changedAt: number) => {
      disk['README.md'] = { path: 'README.md', text, changedAt };
      emit('files.changed', { root: 'C:/Users/me/git/grimoire', path: 'README.md' });
      await TestBed.inject(ApplicationRef).whenStable();
    };
    await views.open(view, 'README.md');
    const tab = view.active()!;
    tab.draft.set('# Mine\n');

    await changeOnDisk('# By the agent\n', 3);
    expect(tab.draft()).toBe('# Mine\n');
    expect(tab.onDisk()?.text).toBe('# By the agent\n');
    views.takeDisk(tab);
    expect(tab.draft()).toBe('# By the agent\n');
    expect(tab.changed()).toBe(false);
    expect(tab.onDisk()).toBeNull();

    // Kept, your changes save over the file as it is on disk now.
    tab.draft.set('# Mine\n');
    await changeOnDisk('# By the agent, again\n', 4);
    tab.comparing.set(true);
    views.keepMine(tab);
    expect(tab.comparing()).toBe(false);
    expect(tab.draft()).toBe('# Mine\n');
    expect(tab.file().changedAt).toBe(4);
    await views.save(view, tab);
    expect(disk['README.md']!.text).toBe('# Mine\n');

    // Discarded, they leave the file as it is on disk now.
    tab.draft.set('# Mine again\n');
    await changeOnDisk('# The agent’s last\n', 5);
    views.discard(tab);
    expect(tab.draft()).toBe('# The agent’s last\n');
    expect(tab.onDisk()).toBeNull();
  });

  it('saves the changes, and says why when it can’t', async () => {
    const { views, view, answers } = await withViews();
    await views.open(view, 'README.md');
    const tab = view.active()!;
    tab.draft.set('# Mine\n');
    await views.save(view, tab);
    expect(tab.file().text).toBe('# Mine\n');
    expect(tab.note()).toEqual({ text: 'Saved.' });

    tab.draft.set('# Mine again\n');
    answers['files.save'] = () => Promise.reject(new Error('It changed on disk first'));
    await views.save(view, tab);
    expect(tab.changed()).toBe(true);
    expect(tab.note()).toEqual({ text: 'It changed on disk first', alert: true });
  });

  it('opens another file over changes not saved, in a tab of its own', async () => {
    const { views, view } = await withViews();
    await views.open(view, 'README.md');
    const readme = view.active()!;
    readme.draft.set('# Mine\n');
    await views.open(view, 'ui/src/seal.ts');
    expect(view.tabs().map((tab) => tab.path)).toEqual(['README.md', 'ui/src/seal.ts']);
    expect(view.active()?.path).toBe('ui/src/seal.ts');
    expect(readme.draft()).toBe('# Mine\n');

    // Closed, a tab gives way to the one beside it; one with changes stays until they're discarded.
    views.close(view, view.active()!);
    expect(view.active()).toBe(readme);
    views.close(view, readme);
    expect(view.tabs()).toEqual([readme]);
    expect(readme.note()?.alert).toBe(true);
    views.discard(readme);
    views.close(view, readme);
    expect(view.tabs()).toEqual([]);
    expect(view.active()).toBeNull();
  });

  it('keeps so many files open, the first without changes making room', async () => {
    const { views, view, answers, calls } = await withViews();
    answers['files.open'] = ({ path }: { path: string }) => ({ path, text: '', changedAt: 1 });
    for (let n = 0; n < MOST_TABS; n++) await views.open(view, `${n}.txt`);
    view.tabs()[0]!.draft.set('mine');
    await views.open(view, 'more.txt');
    expect(view.tabs().map((tab) => tab.path)).toEqual([
      '0.txt',
      ...Array.from({ length: MOST_TABS - 2 }, (_, n) => `${n + 2}.txt`),
      'more.txt',
    ]);
    expect(calls).toContainEqual({
      command: 'files.close',
      request: { cwd: 'C:/Users/me', path: '1.txt' },
    });

    for (const tab of view.tabs()) tab.draft.set('mine');
    await views.open(view, 'last.txt');
    expect(view.tabs()).toHaveLength(MOST_TABS);
    expect(view.note()?.alert).toBe(true);
  });
});
