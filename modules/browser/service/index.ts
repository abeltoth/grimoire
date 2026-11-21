import type { ServiceModule } from '@grimoire/service/core/module';
import { MIGRATIONS } from './migrations';
import { BrowserTabStore } from './store';

/** The browser: its pages live in the app; the service keeps each profile's tabs. */
export const browser: ServiceModule = {
  id: 'browser',
  migrations: MIGRATIONS,
  start({ registry, db }) {
    const store = new BrowserTabStore(db);
    registry.register('browser.tabs', () => store.tabs());
    registry.register('browser.save', (tabs) => store.save(tabs));
    return { profileRemoved: (id) => store.removeProfile(id) };
  },
};
