import type { CommandRegistry } from '../registry';
import type { Terminals } from './terminals';

export function registerTerminals(registry: CommandRegistry, terminals: Terminals): void {
  registry.register('terminal.list', () => terminals.list());
  registry.register('terminal.open', (request) => terminals.open(request));
  registry.register('terminal.screen', ({ id }) => terminals.screen(id));
  registry.register('terminal.write', ({ id, data }) => terminals.write(id, data));
  registry.register('terminal.resize', ({ id, cols, rows }) => terminals.resize(id, cols, rows));
  registry.register('terminal.close', ({ id }) => terminals.close(id));
}
