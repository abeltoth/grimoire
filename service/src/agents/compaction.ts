import type { ChatId, CompactionChange, CompactionSettings } from '@grimoire/contract';
import type { ChatRuns } from './chat-runs';
import type { ChatTable } from './chat-table';
import type { ChatWindows } from './chat-windows';

/** How the agent compacts the open chats, as your agent's settings say, changed from a chat. */
export class Compaction {
  constructor(
    private readonly table: ChatTable,
    private readonly runs: ChatRuns,
    private readonly windows: ChatWindows,
  ) {}

  /** How the agent compacts chats on the chat's model; null when it can't say, or the model isn't known yet. */
  async settings(chatId: ChatId): Promise<CompactionSettings | null> {
    const chat = this.table.chat(chatId);
    const model = chat.context?.model;
    if (!model || !chat.agent.compaction) return null;
    return chat.agent.compaction(model, chat.settings.cwd);
  }

  /**
   * Saves the window for the chat's model. An agent process takes it only
   * as it starts, so each open chat on the model starts again once its turn
   * ends, and its meter shows its window at once.
   */
  async change(chatId: ChatId, change: CompactionChange): Promise<void> {
    const chat = this.table.chat(chatId);
    const model = chat.context?.model;
    const adapter = chat.agent;
    if (!model || !adapter.setCompaction)
      throw new Error("This chat's compaction can't be changed yet");
    await adapter.setCompaction(model, change, chat.settings.cwd);
    const touched = [...this.table.chats.values()].filter(
      (open) => open.agent === adapter && open.context?.model === model,
    );
    for (const open of touched) this.runs.restartWhenIdle(open);
    await this.windows.remeasure(touched);
  }
}
