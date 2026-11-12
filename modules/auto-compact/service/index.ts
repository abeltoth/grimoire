import type { ServiceModule } from '@grimoire/service/core/module';
import { AutoCompact } from './auto-compact';

/** Compacts idle open chats shortly before their prompt cache runs out, when the setting is on. */
export const autoCompact: ServiceModule = {
  id: 'auto-compact',
  start({ events, hub, settings, log }) {
    const auto = new AutoCompact(hub, () => settings.get().autoCompact, log);
    events.on('agents.cache', ({ chatId, cache }) => auto.cached(chatId, cache));
    events.on('agents.entry', ({ chatId, entry }) => {
      if (entry.kind === 'user') auto.wrote(chatId, entry.text);
    });
    events.on('settings.changed', () => auto.reconsider());
    return { profileSwitched: () => auto.forget(), stop: () => auto.forget() };
  },
};
