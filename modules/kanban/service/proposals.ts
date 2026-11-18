import type { EventName, EventPayload, JiraIssueDraft } from '@grimoire/contract';

type Emit = <K extends EventName>(event: K, payload: EventPayload<K>) => void;

/**
 * The Jira issues the agent proposed for chats' work, by chat ID, until
 * you create or dismiss them, telling every window. They're kept only
 * while the service runs: one lost as it stops is proposed again when
 * the work goes on.
 */
export class IssueProposals {
  private readonly drafts = new Map<string, JiraIssueDraft>();

  constructor(private readonly emit: Emit) {}

  all(): Record<string, JiraIssueDraft> {
    return Object.fromEntries(this.drafts);
  }

  /** Keeps the chat's proposal, in place of one it had. */
  propose(chatId: string, draft: JiraIssueDraft): void {
    this.drafts.set(chatId, draft);
    this.emit('kanban.proposed', { chatId, draft });
  }

  /** Puts the chat's proposal away, if it has one. */
  dismiss(chatId: string): void {
    if (this.drafts.delete(chatId)) this.emit('kanban.proposed', { chatId, draft: null });
  }
}
