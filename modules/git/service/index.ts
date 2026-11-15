import type { ServiceModule } from '@grimoire/service/core/module';
import { CommitChats } from './commit-chats';
import { Git } from './git';
import { History } from './history';
import { MIGRATIONS } from './migrations';

/** The git panel: the folder's repository, its changes, its history and its pull request. */
export const git: ServiceModule = {
  id: 'git',
  migrations: MIGRATIONS,
  start({ registry, db, events, hub, log }) {
    const git = new Git();
    const commitChats = new CommitChats(db, git, Date.now);
    const history = new History(git, (shas) => commitChats.chatsOf(shas));
    registry.register('git.status', ({ cwd }) => git.status(cwd));
    registry.register('git.branches', ({ cwd }) => git.branches(cwd));
    registry.register('git.diff', ({ cwd, path }) => git.diff(cwd, path));
    registry.register('git.log', ({ cwd, skip, limit }) => history.log(cwd, skip, limit));
    registry.register('git.commit', ({ cwd, sha }) => history.commit(cwd, sha));
    registry.register('git.commitDiff', ({ cwd, sha, path, from }) =>
      history.commitDiff(cwd, sha, path, from),
    );
    registry.register('git.pullRequest', ({ cwd }) => git.pullRequest(cwd));
    registry.register('git.root', ({ cwd }) => git.root(cwd));
    registry.register('git.files', ({ root }) => git.files(root));
    registry.register('git.ignored', async ({ root, paths }) => [
      ...(await git.ignored(root, paths)),
    ]);
    registry.register('git.committed', ({ cwd, path }) => git.committed(cwd, path));

    // Each turn's new commits are credited to its chat.
    events.on('agents.status', ({ chatId, status }) => {
      const chat = status === 'thinking' ? hub.glance(chatId) : undefined;
      if (chat) void commitChats.turnStarted(chatId, chat.cwd);
    });
    events.on('agents.turnEnded', ({ chatId }) => {
      const chat = hub.glance(chatId);
      if (!chat) return;
      commitChats
        .turnEnded(chatId, { agent: chat.agent, title: chat.title, cwd: chat.cwd })
        .catch((error: unknown) => log(`Couldn't link the turn's commits: ${String(error)}`));
    });
    events.on('agents.title', ({ chatId, title }) => commitChats.renamed(chatId, title));
  },
};
