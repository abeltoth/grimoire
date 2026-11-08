import type { Card, EventName, EventPayload } from '@grimoire/contract';
import type { CommandRegistry } from '../registry';
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
  registry.register('kanban.move', ({ id, column, before }) => changed(cards.move(id, column, before)));
  registry.register('kanban.close', ({ id, closed }) => changed(cards.close(id, closed)));
  registry.register('kanban.link', ({ id, ...chat }) => changed(cards.link(id, chat)));
}
