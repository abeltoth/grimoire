import type { ServiceModule } from '@grimoire/service/core/module';
import { LabelStore } from './label-store';
import { Labeller } from './labeller';
import { MIGRATIONS } from './migrations';
import { PastChats } from './past-chats';

/**
 * Names, tags and sums up chats on each agent's model for quick jobs, as
 * Settings asks (ADR-013): after a chat's turns, and for past chats when
 * you ask. What it gives goes through the agent and the History's commands.
 */
export const autoLabels: ServiceModule = {
  id: 'auto-labels',
  migrations: MIGRATIONS,
  start({ registry, db, events, hub, settings, log }) {
    const store = new LabelStore(db);
    const labeller = new Labeller(
      {
        transcript: (agent, chatId, cwd) => hub.transcript(agent, chatId, cwd),
        ask: (agent, instructions, text, signal) => hub.ask(agent, instructions, text, signal),
        rename: (chatId, title) => hub.rename(chatId, title, 'grimoire'),
        tagsOf: async (chatId) =>
          (await registry.call('history.pinsAndTags', {})).tags[chatId] ?? [],
        setTags: (chatId, tags) => registry.call('history.tag', { chatId, tags: [...tags] }),
        setSummary: (chatId, summary) => registry.call('history.setSummary', { chatId, summary }),
        tagList: () => registry.call('history.tagList', {}),
      },
      store,
      () => settings.get(),
      log,
    );
    const past = new PastChats(
      {
        agents: () => hub.agents(),
        listChats: (agent) => hub.listChats(agent),
        ask: (agent, instructions, text, signal) => hub.ask(agent, instructions, text, signal),
      },
      labeller,
      store,
      (progress) => events.emit('labels.progress', progress),
    );

    events.on('agents.turnEnded', ({ chatId, error }) => {
      const chat = hub.glance(chatId);
      if (error || !chat?.capabilities.includes('ask')) return;
      labeller.turnEnded({ id: chatId, agent: chat.agent, cwd: chat.cwd, title: chat.title });
    });
    events.on('history.tags', ({ chatId, tags }) => labeller.tagsNow(chatId, tags));
    // Kept whether or not labels are on, so a chat you named is never renamed later.
    events.on('agents.title', ({ chatId, by }) => {
      if (by === 'you') store.namedByYou(chatId);
    });

    registry.register('labels.pastCount', () => past.count());
    registry.register('labels.labelPast', () => {
      void past.start();
    });
    registry.register('labels.stopPast', () => past.stop());
    registry.register('labels.progress', () => past.where());
    registry.register('labels.suggestTags', () => past.suggest());
    return {
      stop: () => {
        past.stop();
        labeller.stop();
      },
    };
  },
};
