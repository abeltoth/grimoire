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
  registry.register('agents.usage', ({ agent }) => hub.usage(agent));
  registry.register('agents.usageHistory', ({ agent, since }) => hub.usageHistory(agent, since));
  registry.register('agents.usageBreakdown', ({ agent }) => hub.usageBreakdown(agent));
  registry.register('agents.account', ({ agent }) => hub.account(agent));
  registry.register('agents.signIn', ({ agent, email }) => hub.signIn(agent, email));
  registry.register('agents.signInCode', ({ agent, code }) => hub.signInCode(agent, code));
  registry.register('agents.cancelSignIn', ({ agent }) => hub.cancelSignIn(agent));
  registry.register('agents.setup', ({ agent, cwd }) => hub.setup(agent, cwd));
  registry.register('agents.setupFolders', () => hub.setupFolders());
  registry.register('agents.memories', ({ agent, cwd }) => hub.memories(agent, cwd));
  registry.register('agents.openMemory', ({ agent, cwd, path }) =>
    hub.openMemory(agent, cwd, path),
  );
  registry.register('agents.saveMemory', ({ agent, cwd, path, text, changedAt }) =>
    hub.saveMemory(agent, cwd, path, text, changedAt),
  );
  registry.register('agents.deleteMemory', ({ agent, cwd, path, changedAt }) =>
    hub.deleteMemory(agent, cwd, path, changedAt),
  );
  registry.register('agents.openSetupFile', ({ agent, cwd, path }) =>
    hub.openSetupFile(agent, cwd, path),
  );
  registry.register('agents.saveSetupFile', ({ agent, cwd, path, text, changedAt }) =>
    hub.saveSetupFile(agent, cwd, path, text, changedAt),
  );
  registry.register('agents.folders', () => hub.folders());
  registry.register('agents.configure', ({ chatId, change }) => hub.configure(chatId, change));
  registry.register('agents.start', ({ agent, settings, text, title, enclosures }) =>
    hub.start(agent, settings, text, title, enclosures),
  );
  registry.register('agents.rename', ({ chatId, title }) => hub.rename(chatId, title));
  registry.register('agents.tag', ({ chatId, tags }) => hub.tag(chatId, tags));
  registry.register('agents.send', ({ chatId, text, enclosures }) =>
    hub.send(chatId, text, enclosures),
  );
  registry.register('agents.undo', ({ chatId, entryId }) => hub.undo(chatId, entryId));
  registry.register('agents.helper', ({ chatId, toolId }) => hub.helper(chatId, toolId));
  registry.register('agents.fork', ({ chatId, entryId }) => hub.fork(chatId, entryId));
  registry.register('agents.parallel', ({ from, model, text, enclosures }) =>
    hub.parallel(from, model, text, enclosures),
  );
  registry.register('agents.dogEar', ({ chatId, dogEar, folded }) =>
    hub.dogEar(chatId, dogEar, folded),
  );
  registry.register('agents.takeFollowUp', ({ chatId, index }) => hub.takeFollowUp(chatId, index));
  registry.register('agents.unqueue', ({ chatId, id }) => hub.unqueue(chatId, id));
  registry.register('agents.interrupt', ({ chatId }) => hub.interrupt(chatId));
  registry.register('agents.decide', ({ approvalId, decision }) =>
    hub.decide(approvalId, decision),
  );
  registry.register('agents.answer', ({ approvalId, answers }) => hub.answer(approvalId, answers));
  registry.register('agents.close', ({ chatId }) => hub.close(chatId));
}
