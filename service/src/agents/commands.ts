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
  registry.register('agents.account', ({ agent }) => hub.account(agent));
  registry.register('agents.signIn', ({ agent, email }) => hub.signIn(agent, email));
  registry.register('agents.signInCode', ({ agent, code }) => hub.signInCode(agent, code));
  registry.register('agents.cancelSignIn', ({ agent }) => hub.cancelSignIn(agent));
  registry.register('agents.folders', () => hub.folders());
  registry.register('agents.configure', ({ chatId, change }) => hub.configure(chatId, change));
  registry.register('agents.start', ({ agent, settings, text, title, attachments }) =>
    hub.start(agent, settings, text, title, attachments),
  );
  registry.register('agents.rename', ({ chatId, title }) => hub.rename(chatId, title));
  registry.register('agents.send', ({ chatId, text, attachments }) =>
    hub.send(chatId, text, attachments),
  );
  registry.register('agents.undo', ({ chatId, entryId }) => hub.undo(chatId, entryId));
  registry.register('agents.subagent', ({ chatId, toolId }) => hub.subagent(chatId, toolId));
  registry.register('agents.fork', ({ chatId, entryId }) => hub.fork(chatId, entryId));
  registry.register('agents.parallel', ({ from, model, text, attachments }) =>
    hub.parallel(from, model, text, attachments),
  );
  registry.register('agents.takeFollowUp', ({ chatId, index }) => hub.takeFollowUp(chatId, index));
  registry.register('agents.unqueue', ({ chatId, id }) => hub.unqueue(chatId, id));
  registry.register('agents.interrupt', ({ chatId }) => hub.interrupt(chatId));
  registry.register('agents.decide', ({ approvalId, decision }) =>
    hub.decide(approvalId, decision),
  );
  registry.register('agents.answer', ({ approvalId, answers }) => hub.answer(approvalId, answers));
  registry.register('agents.takeOver', ({ chatId }) => hub.takeOver(chatId));
  registry.register('agents.close', ({ chatId }) => hub.close(chatId));
}
