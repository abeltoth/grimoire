import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { repository } from './files-testing';
import { FilesViews } from './files-views';

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

  it('reads a file open again when it changes on disk, over changes not saved', async () => {
    const { views, view, emit, disk } = await withViews();
    await views.open(view, 'README.md');
    view.draft.set('# Mine\n');

    disk['README.md'] = { path: 'README.md', text: '# Grimoire, by the agent\n', changedAt: 3 };
    emit('files.changed', { root: 'C:/Users/me/git/grimoire', path: 'README.md' });
    await TestBed.inject(ApplicationRef).whenStable();
    expect(view.draft()).toBe('# Grimoire, by the agent\n');
    expect(view.changed()).toBe(false);
    expect(view.note()).toEqual({ text: 'It changed on disk, and was read again.' });

    // Another folder's file of the same name isn't this one.
    disk['README.md'] = { path: 'README.md', text: '# Elsewhere\n', changedAt: 4 };
    emit('files.changed', { root: 'C:/Users/me/git/other', path: 'README.md' });
    await TestBed.inject(ApplicationRef).whenStable();
    expect(view.draft()).toBe('# Grimoire, by the agent\n');
  });

  it('saves the changes, and says why when it can’t', async () => {
    const { views, view, answers } = await withViews();
    await views.open(view, 'README.md');
    view.draft.set('# Mine\n');
    await views.save(view);
    expect(view.file()?.text).toBe('# Mine\n');
    expect(view.note()).toEqual({ text: 'Saved.' });

    view.draft.set('# Mine again\n');
    answers['files.save'] = () => Promise.reject(new Error('It changed on disk first'));
    await views.save(view);
    expect(view.changed()).toBe(true);
    expect(view.note()).toEqual({ text: 'It changed on disk first', alert: true });
  });

  it('opens nothing over changes not saved, until they’re discarded', async () => {
    const { views, view } = await withViews();
    await views.open(view, 'README.md');
    view.draft.set('# Mine\n');
    await views.open(view, 'ui/src/seal.ts');
    expect(view.file()?.path).toBe('README.md');
    expect(view.note()?.alert).toBe(true);

    views.discard(view);
    await views.open(view, 'ui/src/seal.ts');
    expect(view.file()?.path).toBe('ui/src/seal.ts');
  });
});
