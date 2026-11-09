import type { Answer, Approval, ApprovalDecision } from '@grimoire/contract';
import type { Emit } from '../events';
import type { ApprovalRequest, Verdict } from './adapter';
import type { ChatState, ChatTable } from './chat-table';
import type { ChatUpdates } from './chat-updates';

interface PendingApproval {
  approval: Approval;
  resolve: (verdict: Verdict) => void;
}

/**
 * The approvals waiting for you, each until you decide, the agent stops
 * waiting for it, or its chat's turn or process ends. A chat waits while
 * it has one, and thinks again once the last is settled.
 */
export class Approvals {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(
    private readonly emit: Emit,
    private readonly table: ChatTable,
    private readonly updates: ChatUpdates,
  ) {}

  /** Waits for your decision on what the agent asks; denied once `signal` says it stopped waiting. */
  ask(chat: ChatState, request: ApprovalRequest, signal: AbortSignal): Promise<Verdict> {
    return new Promise<Verdict>((resolve) => {
      if (signal.aborted) return resolve('deny');
      const approval: Approval = { ...request, chatId: chat.id, at: Date.now() };
      const pending: PendingApproval = { approval, resolve };
      this.pending.set(approval.id, pending);
      signal.addEventListener('abort', () => this.settle(pending, 'deny'), { once: true });
      this.updates.flush(chat);
      this.emit('agents.approval', { approval });
      this.updates.setStatus(chat, 'waiting');
    });
  }

  decide(approvalId: string, decision: ApprovalDecision): void {
    const pending = this.waiting(approvalId);
    if (pending.approval.questions && decision !== 'deny')
      throw new Error('This approval asks questions; answer them instead');
    this.settle(pending, decision);
  }

  answer(approvalId: string, answers: Answer[]): void {
    const pending = this.waiting(approvalId);
    const { questions } = pending.approval;
    if (!questions) throw new Error('This approval asks no questions');
    if (answers.length !== questions.length)
      throw new Error(`Expected ${questions.length} answers, got ${answers.length}`);
    this.settle(pending, { answers });
  }

  /** The approvals waiting in a chat, in the order they came. */
  of(chat: ChatState): Approval[] {
    return [...this.pending.values()]
      .filter((pending) => pending.approval.chatId === chat.id)
      .map((pending) => pending.approval);
  }

  has(chat: ChatState): boolean {
    return [...this.pending.values()].some((pending) => pending.approval.chatId === chat.id);
  }

  /** Denies every approval waiting in a chat, as when its turn or process ends. */
  denyAll(chat: ChatState): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.approval.chatId === chat.id) this.settle(pending, 'deny');
    }
  }

  private waiting(approvalId: string): PendingApproval {
    const pending = this.pending.get(approvalId);
    if (!pending) throw new Error('This approval is no longer pending');
    return pending;
  }

  private settle(pending: PendingApproval, verdict: Verdict): void {
    const { approval } = pending;
    if (!this.pending.delete(approval.id)) return;
    pending.resolve(verdict);
    this.emit('agents.approvalSettled', { chatId: approval.chatId, approvalId: approval.id });
    const chat = this.table.chats.get(approval.chatId);
    if (chat && chat.status === 'waiting' && !this.has(chat))
      this.updates.setStatus(chat, 'thinking');
  }
}
