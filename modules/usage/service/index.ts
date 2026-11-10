import type { ServiceModule } from '@grimoire/service/core/module';
import { MIGRATIONS } from './migrations';
import { UsageReadings } from './readings';
import { USAGE_SOURCES } from './sources';
import { Usage } from './usage';

/** The Usage page's backend: the agents' plan limits over time, and where their usage went. */
export const usage: ServiceModule = {
  id: 'usage',
  migrations: MIGRATIONS,
  start({ registry, db, events, hub }) {
    const usage = new Usage(new UsageReadings(db), USAGE_SOURCES, () =>
      hub.agents().map((agent) => agent.id),
    );
    registry.register('usage.plan', ({ agent }) => usage.plan(agent));
    registry.register('usage.history', ({ agent, since }) => usage.history(agent, since));
    registry.register('usage.breakdown', ({ agent }) => usage.breakdown(agent));
    // Signed in to another account, the plan's limits are read again, as they're that account's.
    events.on('agents.account', ({ agent, account, pending }) => {
      if (account && !pending) usage.plan(agent).catch(() => {});
    });
    // The plan's limits are read every quarter of an hour, for the Usage page's history.
    return { ready: () => void usage.readEvery(15 * 60_000) };
  },
};
