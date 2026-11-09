import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERSONAL_PROFILE } from '@grimoire/contract';
import type { ServiceModule } from '@grimoire/service/module';
import { SearchWorker, forkWorker } from './search-worker';

/** Full-text search across past chats, and the token totals counted from them, in a worker of its own (ADR-010). */
export const search: ServiceModule = {
  id: 'search',
  start({ registry, events, profiles, dataDir, ephemeral, log }) {
    // Each profile's index is kept beside Grimoire's data.
    const indexFile = (profile: string) =>
      path.join(dataDir, profile === PERSONAL_PROFILE ? 'search.db' : `search-${profile}.db`);
    const search = new SearchWorker(
      () =>
        forkWorker(
          // The worker is bundled beside the service.
          fileURLToPath(new URL('./search-worker.mjs', import.meta.url)),
          ephemeral ? ':memory:' : indexFile(profiles.active().id),
        ),
      log,
    );
    registry.register('search.chats', ({ query }) => search.search(query));
    registry.register('search.tokens', ({ since }) => search.tokens(since));
    // A turn or a new title changes what a search finds.
    events.on('agents.turnEnded', () => search.markStale());
    events.on('agents.title', () => search.markStale());
    return {
      ready: () => search.warm(),
      profileSwitched: () => search.restart(),
      stop: () => search.close(),
    };
  },
};
