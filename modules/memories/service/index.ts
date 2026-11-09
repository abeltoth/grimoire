import type { ServiceModule } from '@grimoire/service/module';
import { Memories } from './memories';
import { MEMORY_SOURCES } from './sources';

/** The memory graph's backend: the memories each agent keeps on its own, edited in place. */
export const memories: ServiceModule = {
  id: 'memories',
  start({ registry, events }) {
    const memories = new Memories(MEMORY_SOURCES, (agent, cwd) =>
      events.emit('memories.changed', { agent, cwd }),
    );
    registry.register('memories.list', ({ agent, cwd }) => memories.list(agent, cwd));
    registry.register('memories.open', ({ agent, cwd, path }) => memories.open(agent, cwd, path));
    registry.register('memories.save', ({ agent, cwd, path, text, changedAt }) =>
      memories.save(agent, cwd, path, text, changedAt),
    );
    registry.register('memories.delete', ({ agent, cwd, path, changedAt }) =>
      memories.delete(agent, cwd, path, changedAt),
    );
    // Another profile's memories are watched once they're read.
    return { profileSwitched: () => memories.dispose(), stop: () => memories.dispose() };
  },
};
