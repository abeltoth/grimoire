import type { CommandRegistry } from '../registry';
import type { SearchWorker } from './search-worker';

export function registerSearch(registry: CommandRegistry, search: SearchWorker): void {
  registry.register('search.chats', ({ query }) => search.search(query));
}
