import type { CommandRegistry } from '../registry';
import type { Scheduler } from './scheduler';

export function registerSchedules(registry: CommandRegistry, scheduler: Scheduler): void {
  registry.register('schedules.list', () => scheduler.list());
  registry.register('schedules.save', (draft) => scheduler.save(draft));
  registry.register('schedules.remove', ({ id }) => scheduler.remove(id));
  registry.register('schedules.run', ({ id }) => scheduler.run(id));
}
