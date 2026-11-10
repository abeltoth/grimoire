import type { ServiceModule } from '@grimoire/service/core/module';
import { Git } from './git';

/** The git panel: the folder's repository, its changes and its pull request. */
export const git: ServiceModule = {
  id: 'git',
  start({ registry }) {
    const git = new Git();
    registry.register('git.status', ({ cwd }) => git.status(cwd));
    registry.register('git.branches', ({ cwd }) => git.branches(cwd));
    registry.register('git.diff', ({ cwd, path }) => git.diff(cwd, path));
    registry.register('git.pullRequest', ({ cwd }) => git.pullRequest(cwd));
    registry.register('git.root', ({ cwd }) => git.root(cwd));
    registry.register('git.files', ({ root }) => git.files(root));
    registry.register('git.ignored', async ({ root, paths }) => [
      ...(await git.ignored(root, paths)),
    ]);
    registry.register('git.committed', ({ cwd, path }) => git.committed(cwd, path));
  },
};
