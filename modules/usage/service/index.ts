import type { ServiceModule } from '@grimoire/service/core/module';
import { MIGRATIONS } from './migrations';
import { UsageReadings } from './readings';
import { ReadSchedule } from './schedule';
import { USAGE_SOURCES } from './sources';
import { Usage } from './usage';

const MINUTE = 60_000;

/** The Usage page's backend: the agents' plan limits over time, and where their usage went. */
export const usage: ServiceModule = {
  id: 'usage',
  migrations: MIGRATIONS,
  start({ registry, db, events, hub }) {
    const usage = new Usage(
      new UsageReadings(db),
      USAGE_SOURCES,
      () => hub.agents().map((agent) => agent.id),
      (agent, usage) => events.emit('usage.read', { agent, usage }),
    );
    registry.register('usage.plan', ({ agent }) => usage.plan(agent));
    registry.register('usage.history', ({ agent, since }) => usage.history(agent, since));
    registry.register('usage.weeks', ({ agent }) => usage.weeks(agent));
    registry.register('usage.breakdown', ({ agent }) => usage.breakdown(agent));
    // Signed in to another account, the plan's limits are read again, as they're that account's.
    events.on('agents.account', ({ agent, account, pending }) => {
      if (account && !pending) usage.plan(agent).catch(() => {});
    });
    const schedule = new ReadSchedule(
      () => usage.readAll(),
      { idle: 30 * MINUTE, busy: 5 * MINUTE, lately: 10 * MINUTE },
      Date.now,
    );
    events.on('agents.status', ({ status }) => {
      if (status !== 'idle') schedule.busy();
    });
    events.on('agents.turnEnded', () => schedule.busy());
    return { ready: () => schedule.start(), stop: () => schedule.stop() };
  },
};
