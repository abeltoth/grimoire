import type { Card, EventName, EventPayload } from '@grimoire/contract';
import type { CommandRegistry } from '@grimoire/service/core/registry';
import type { JiraMoves } from './jira-moves';
import type { JiraSyncer } from './jira-sync';
import type { CardStore } from './store';

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/** The Kanban board's commands; each change is told to every window. */
export function registerKanban(registry: CommandRegistry, cards: CardStore, emit: Emit): void {
  const changed = (all: Card[]) => {
    emit('kanban.changed', { cards: all });
    return all;
  };
  registry.register('kanban.list', () => cards.list());
  registry.register('kanban.save', (draft) => changed(cards.save(draft)));
  registry.register('kanban.move', ({ id, column, before }) =>
    changed(cards.move(id, column, before)),
  );
  registry.register('kanban.close', ({ id, closed }) => changed(cards.close(id, closed)));
  registry.register('kanban.link', ({ id, ...chat }) => changed(cards.link(id, chat)));
}

/**
 * Where the board's Jira issues stand, syncing them now, and moving one in
 * Jira; the syncer and the moves tell every window.
 */
export function registerJira(registry: CommandRegistry, jira: JiraSyncer, moves: JiraMoves): void {
  registry.register('kanban.jira', () => jira.state());
  registry.register('kanban.syncJira', ({ ifOlderThan }) =>
    jira.sync(ifOlderThan !== undefined ? { ifOlderThan } : {}),
  );
  registry.register('kanban.transitions', ({ id, column }) => moves.transitions(id, column));
  registry.register('kanban.transition', ({ id, transition }) => moves.transition(id, transition));
}
