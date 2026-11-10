import type { ServiceModule } from '@grimoire/service/core/module';
import { Terminals } from './terminals';

/** The Terminal: shells the service runs, each shown as a tab. */
export const terminal: ServiceModule = {
  id: 'terminal',
  start({ registry, events }) {
    const terminals = new Terminals(events.emit);
    registry.register('terminal.list', () => terminals.list());
    registry.register('terminal.open', (request) => terminals.open(request));
    registry.register('terminal.screen', ({ id }) => terminals.screen(id));
    registry.register('terminal.write', ({ id, data }) => terminals.write(id, data));
    registry.register('terminal.resize', ({ id, cols, rows }) => terminals.resize(id, cols, rows));
    registry.register('terminal.close', ({ id }) => terminals.close(id));
    return { stop: () => terminals.closeAll() };
  },
};
