import type { ServiceModule } from '@grimoire/service/module';
import { SETUP_READERS } from './readers';
import { Setup, setupFolders } from './setup';

/** The workflow setup view's backend: everything an agent loads in a folder, editable in place. */
export const workflowSetup: ServiceModule = {
  id: 'workflow-setup',
  start({ registry, events, hub }) {
    const setup = new Setup(SETUP_READERS, (agent, cwd) =>
      events.emit('setup.changed', { agent, cwd }),
    );
    registry.register('setup.get', ({ agent, cwd }) => setup.get(agent, cwd));
    registry.register('setup.folders', async () => setupFolders((await hub.folders()).recent));
    registry.register('setup.openFile', ({ agent, cwd, path }) => setup.openFile(agent, cwd, path));
    registry.register('setup.saveFile', ({ agent, cwd, path, text, changedAt }) =>
      setup.saveFile(agent, cwd, path, text, changedAt),
    );
    // Another profile's setups are watched once they're read.
    return { profileSwitched: () => setup.dispose(), stop: () => setup.dispose() };
  },
};
