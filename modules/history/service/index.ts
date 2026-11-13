import type { ServiceModule } from '@grimoire/service/core/module';
import { MIGRATIONS } from './migrations';
import { Pins } from './pins';
import { TagList } from './tag-list';
import { Tags, keptTags, renamed } from './tags';

/** The history's backend: which chats are pinned or starred, your tags for them, and your tag list. */
export const history: ServiceModule = {
  id: 'history',
  migrations: MIGRATIONS,
  start({ registry, db, events }) {
    const pins = new Pins(db);
    const tags = new Tags(db);
    const list = new TagList(db);
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
    registry.register('history.tagList', () => list.all());
    registry.register('history.setTagList', ({ tags: given }) => {
      events.emit('history.tagListChanged', { tags: list.set(given) });
    });
    registry.register('history.renameTag', ({ from, to }) => {
      const name = to.trim();
      if (!name) throw new Error('A tag needs a name');
      const wanted = from.trim().toLowerCase();
      for (const [chatId, had] of tags.all()) {
        if (!had.some((tag) => tag.toLowerCase() === wanted)) continue;
        const now = renamed(had, from.trim(), name);
        tags.set(chatId, now);
        events.emit('history.tags', { chatId, tags: now });
      }
      const listed = list.all();
      if (listed.some((tag) => tag.toLowerCase() === wanted)) {
        events.emit('history.tagListChanged', {
          tags: list.set(renamed(listed, from.trim(), name)),
        });
      }
    });
  },
};
