import type { ContextUsage, ContextWindow } from '@grimoire/contract';
import type { Emit } from '../events';
import type { ContextWindows } from '../storage/context-windows';
import type { ChatHistory } from './adapter';
import type { ChatState, ChatTable } from './chat-table';

/**
 * The context windows the agents measured, by model, so a reopened chat's
 * meter shows before its agent runs: its last reply's tokens in its
 * model's window, measured apart, once, when no chat on that model was.
 */
export class ChatWindows {
  /** The measures under way, by agent and model: one at a time each. */
  private readonly measuring = new Map<string, Promise<ContextWindow | undefined>>();

  constructor(
    private readonly emit: Emit,
    private readonly table: ChatTable,
    private readonly store: ContextWindows,
  ) {}

  /** Keeps the window a chat's agent measured, for any chat on its model. */
  keep(chat: ChatState, context: ContextUsage, before: ContextUsage | undefined): void {
    if (!context.model) return;
    const same =
      before?.model === context.model &&
      before.limit === context.limit &&
      before.compactsAt === context.compactsAt;
    if (same) return;
    this.store.put(chat.agent.info.id, context.model, {
      limit: context.limit,
      ...(context.compactsAt ? { compactsAt: context.compactsAt } : {}),
    });
  }

  /** Shows a reopened chat's meter, from what its transcript saved. */
  show(chat: ChatState, { model, cache }: ChatHistory): void {
    if (!model || !cache || chat.context) return;
    const agent = chat.agent.info.id;
    const kept = this.store.get(agent, model);
    if (kept) {
      chat.context = { used: cache.tokens, ...kept, model };
      return;
    }
    void this.measure(chat, model).then((window) => {
      // It may have closed, or its agent measured it, meanwhile.
      if (!window || chat.context || this.table.chats.get(chat.id) !== chat) return;
      chat.context = { used: cache.tokens, ...window, model };
      this.emit('agents.context', { chatId: chat.id, context: chat.context });
    });
  }

  private measure(chat: ChatState, model: string): Promise<ContextWindow | undefined> {
    const adapter = chat.agent;
    if (!adapter.contextWindow) return Promise.resolve(undefined);
    const key = `${adapter.info.id}\n${model}`;
    let measuring = this.measuring.get(key);
    if (!measuring) {
      measuring = adapter.contextWindow(model, chat.settings.cwd).then(
        (window) => {
          this.store.put(adapter.info.id, model, window);
          return window;
        },
        () => undefined,
      );
      this.measuring.set(key, measuring);
      void measuring.finally(() => this.measuring.delete(key));
    }
    return measuring;
  }
}
