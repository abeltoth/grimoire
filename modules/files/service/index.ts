import type { ServiceModule } from '@grimoire/service/module';
import { type CommandRegistry, UnknownCommandError } from '@grimoire/service/registry';
import { Files, type Repos } from './files';

/** The file pane: a project's files, to find, view and edit. */
export const files: ServiceModule = {
  id: 'files',
  start({ registry, events }) {
    const files = new Files(reposThrough(registry), events.emit);
    registry.register('files.list', ({ cwd, path }) => files.list(cwd, path));
    registry.register('files.find', ({ cwd, query }) => files.find(cwd, query));
    registry.register('files.open', ({ cwd, path }) => files.open(cwd, path));
    registry.register('files.save', ({ cwd, path, text, changedAt }) =>
      files.save(cwd, path, text, changedAt),
    );
    registry.register('files.close', ({ cwd, path }) => files.close(cwd, path));
    return { stop: () => files.dispose() };
  },
};

/** Git, through the git module's commands; without that module every folder is outside a repository. */
export function reposThrough(registry: CommandRegistry): Repos {
  return {
    root: (cwd) =>
      registry.call('git.root', { cwd }).catch((error: unknown) => {
        if (error instanceof UnknownCommandError) return null;
        throw error;
      }),
    files: (root) => registry.call('git.files', { root }),
    ignored: async (root, paths) => new Set(await registry.call('git.ignored', { root, paths })),
    committed: (cwd, path) => registry.call('git.committed', { cwd, path }),
  };
}
