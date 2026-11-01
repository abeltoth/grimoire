import type { CommandRegistry } from '../registry';
import type { AgentHub } from './hub';

/** The agent hub's commands (see contract/src/agents.ts). */
export function registerAgentCommands(registry: CommandRegistry, hub: AgentHub): void {
  registry.register('agents.list', () => hub.agents());
  registry.register('agents.chats', ({ agent, cwd }) => hub.listChats(agent, cwd));
  registry.register('agents.openChats', () => hub.openChats());
  registry.register('agents.open', ({ agent, chatId, settings }) =>
    hub.open(agent, chatId, settings),
  );
  registry.register('agents.models', ({ agent }) => hub.models(agent));
  registry.register('agents.commands', ({ agent, cwd }) => hub.commands(agent, cwd));
  registry.register('agents.folders', () => hub.folders());
  registry.register('agents.configure', ({ chatId, change }) => hub.configure(chatId, change));
  registry.register('agents.start', ({ agent, settings, text }) =>
    hub.start(agent, settings, text),
  );
  registry.register('agents.send', ({ chatId, text }) => hub.send(chatId, text));
  registry.register('agents.undo', ({ chatId, entryId }) => hub.undo(chatId, entryId));
  registry.register('agents.fork', ({ chatId, entryId }) => hub.fork(chatId, entryId));
  registry.register('agents.dogEar', ({ chatId, dogEar, folded }) =>
    hub.dogEar(chatId, dogEar, folded),
  );
  registry.register('agents.unqueue', ({ chatId, id }) => hub.unqueue(chatId, id));
  registry.register('agents.interrupt', ({ chatId }) => hub.interrupt(chatId));
  registry.register('agents.decide', ({ approvalId, decision }) =>
    hub.decide(approvalId, decision),
  );
  registry.register('agents.answer', ({ approvalId, answers }) => hub.answer(approvalId, answers));
  registry.register('agents.close', ({ chatId }) => hub.close(chatId));
}
