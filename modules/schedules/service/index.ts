import type { ServiceModule } from '@grimoire/service/core/module';
import { MIGRATIONS } from './migrations';
import { Scheduler } from './scheduler';
import { ScheduleStore } from './store';

/** Scheduled chats, such as a morning summary of a repository's changes. */
export const schedules: ServiceModule = {
  id: 'schedules',
  migrations: MIGRATIONS,
  start({ registry, db, events, hub }) {
    const store = new ScheduleStore(db);
    const scheduler = new Scheduler(
      store,
      (agent, settings, text, title) => hub.start(agent, settings, text, title),
      events.emit,
    );
    registry.register('schedules.list', () => scheduler.list());
    registry.register('schedules.save', (draft) => scheduler.save(draft));
    registry.register('schedules.remove', ({ id }) => scheduler.remove(id));
    registry.register('schedules.run', ({ id }) => scheduler.run(id));
    return {
      // Checked twice a minute, which also notices a time that passed while the computer slept.
      ready: () => void scheduler.checkEvery(30_000),
      profileSwitched: () => events.emit('schedules.changed', { schedules: scheduler.list() }),
      profileRemoved: (id) => store.removeProfile(id),
    };
  },
};
