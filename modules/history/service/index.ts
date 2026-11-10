import type { ServiceModule } from '@grimoire/service/core/module';
import { MIGRATIONS } from './migrations';
import { Pins } from './pins';
import { Tags, keptTags } from './tags';

/** The history's backend: which chats are pinned or starred, and your tags for them. */
export const history: ServiceModule = {
  id: 'history',
  migrations: MIGRATIONS,
  start({ registry, db, events }) {
    const pins = new Pins(db);
    const tags = new Tags(db);
    registry.register('history.pinsAndTags', () => ({
      pins: Object.fromEntries(pins.all()),
      tags: Object.fromEntries(tags.all()),
    }));
    registry.register('history.pin', ({ chatId, mark, on }) => {
      pins.set(chatId, mark, on);
      events.emit('history.pins', { chatId, pins: pins.of(chatId) });
    });
    registry.register('history.tag', ({ chatId, tags: given }) => {
      const kept = keptTags(given);
      tags.set(chatId, kept);
      events.emit('history.tags', { chatId, tags: kept });
    });
  },
};
