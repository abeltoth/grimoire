import type { CommandRegistry } from '../registry';
import type { Git } from './git';

export function registerGit(registry: CommandRegistry, git: Git): void {
  registry.register('git.status', ({ cwd }) => git.status(cwd));
  registry.register('git.branches', ({ cwd }) => git.branches(cwd));
  registry.register('git.diff', ({ cwd, path }) => git.diff(cwd, path));
  registry.register('git.pullRequest', ({ cwd }) => git.pullRequest(cwd));
}
