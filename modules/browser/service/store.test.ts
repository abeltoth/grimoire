import { beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '@grimoire/service/testing/database';
import { MIGRATIONS } from './migrations';
import { BrowserTabStore } from './store';

let profile: string;
let store: BrowserTabStore;

beforeEach(() => {
  profile = 'personal';
  const db = openDatabase(':memory:');
  migrate(db, 'browser', MIGRATIONS);
  store = new BrowserTabStore(db, () => profile);
});

const gemini = { url: 'https://gemini.google.com/app', title: 'Gemini' };
const pinterest = { url: 'https://www.pinterest.com/', title: 'Pinterest' };

describe('the browser tabs', () => {
  it('has none before any are saved', () => {
    expect(store.tabs()).toEqual({ tabs: [], shown: 0 });
  });

  it('keeps the tabs in order, with the one that shows, in place of those before', () => {
    store.save({ tabs: [gemini], shown: 0 });
    store.save({ tabs: [gemini, pinterest], shown: 1 });
    expect(store.tabs()).toEqual({ tabs: [gemini, pinterest], shown: 1 });
  });

  it('keeps each profile’s own, and deletes a removed profile’s', () => {
    store.save({ tabs: [gemini], shown: 0 });
    profile = 'work';
    store.save({ tabs: [pinterest], shown: 0 });
    expect(store.tabs().tabs).toEqual([pinterest]);
    store.removeProfile('personal');
    profile = 'personal';
    expect(store.tabs().tabs).toEqual([]);
  });
});
