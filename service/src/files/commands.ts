import type { CommandRegistry } from '../registry';
import type { Files } from './files';

export function registerFiles(registry: CommandRegistry, files: Files): void {
  registry.register('files.list', ({ cwd, path }) => files.list(cwd, path));
  registry.register('files.find', ({ cwd, query }) => files.find(cwd, query));
  registry.register('files.open', ({ cwd, path }) => files.open(cwd, path));
  registry.register('files.save', ({ cwd, path, text, changedAt }) =>
    files.save(cwd, path, text, changedAt),
  );
  registry.register('files.close', ({ cwd, path }) => files.close(cwd, path));
}
