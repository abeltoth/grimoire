import { openConnectors } from '@grimoire/service/claude/connectors';
import type { ServiceModule } from '@grimoire/service/core/module';
import { addTodoTool } from './add-todo';
import { registerJira, registerKanban } from './commands';
import { JiraMoves } from './jira-moves';
import { JiraSyncer } from './jira-sync';
import { MIGRATIONS } from './migrations';
import { CardStore } from './store';

/** The Kanban board: tasks as cards, each launching a chat, with your Jira issues beside them. */
export const kanban: ServiceModule = {
  id: 'kanban',
  migrations: MIGRATIONS,
  start({ registry, db, events, settings, log, registerTool }) {
    const cards = new CardStore(db);
    registerKanban(registry, cards, events.emit);
    // Your Jira issues come through your claude.ai Atlassian connector, on a Claude Code process of their own;
    // moving one in Jira, on another, the one that may change Jira.
    const jira = new JiraSyncer(
      cards,
      () => settings.get().jiraQuery,
      openConnectors,
      events.emit,
      log,
    );
    const moves = new JiraMoves(cards, openConnectors, events.emit, log);
    registerJira(registry, jira, moves);
    // A task the agent adds goes on the board in use, which every window is told of.
    registerTool(
      addTodoTool((draft, madeIn) =>
        events.emit('kanban.changed', { cards: cards.save(draft, madeIn) }),
      ),
    );
    return {
      // The board's Jira issues are synced every hour, as well as when the board opens.
      ready: () => jira.syncEvery(60 * 60_000),
      profileSwitched: () => {
        events.emit('kanban.changed', { cards: cards.list() });
        events.emit('kanban.jira', { jira: jira.state() });
      },
      profileRemoved: (id) => cards.removeProfile(id),
      stop: () => moves.close(),
    };
  },
};
