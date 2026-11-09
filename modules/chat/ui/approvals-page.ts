import { Component, ElementRef, computed, effect, inject, input } from '@angular/core';
import type { Approval, ApprovalDecision } from '@grimoire/contract';
import { type Chat, Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { PageFooter } from '@ui/app/shell/page-footer';
import { PageHeader } from '@ui/app/shell/page-header';
import { ApprovalCard } from './approval-card';

interface Waiting {
  chat: Chat;
  approval: Approval;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The right page turned to every waiting approval, from all open
 * chats, oldest first. Approving one here answers it in its chat. ↑ and
 * ↓ move between approval cards; Esc turns back, and so does approving the last one.
 */
@Component({
  selector: 'gr-approvals-page',
  imports: [ApprovalCard, PageFooter, PageHeader],
  templateUrl: './approvals-page.html',
  styleUrl: './approvals-page.css',
  host: {
    '(document:keydown.escape)': 'back($event)',
    '(keydown.arrowdown)': 'move($event, 1)',
    '(keydown.arrowup)': 'move($event, -1)',
  },
})
export class ApprovalsPage {
  /** The label of the page it turns back to. */
  readonly backTo = input.required<string>();

  protected readonly chats = inject(Chats);
  protected readonly rightPage = inject(RightPageState);
  protected readonly wording = inject(Wording);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly approvalCards = computed<Waiting[]>(() =>
    this.chats
      .all()
      .flatMap((chat) =>
        // Questions wait for answers in their chat, not for an approval.
        chat.approvals.filter((a) => !a.questions).map((approval) => ({ chat, approval })),
      )
      .sort((a, b) => (a.approval.at ?? 0) - (b.approval.at ?? 0)),
  );
  protected readonly summary = computed(() => {
    const approvalCards = this.approvalCards();
    const chats = new Set(approvalCards.map((approvalCard) => approvalCard.chat.id)).size;
    const [approvalCard, chat] = this.wording.plain() ? ['request', 'chat'] : ['slip', 'chapter'];
    return `${plural(approvalCards.length, approvalCard)} from ${plural(chats, chat)}, oldest first`;
  });
  /** The approval card you start on. */
  protected readonly first = computed(() => {
    const asked = this.rightPage.firstApproval();
    const approvalCards = this.approvalCards();
    return approvalCards.some((approvalCard) => approvalCard.approval.id === asked)
      ? asked
      : approvalCards[0]?.approval.id;
  });

  constructor() {
    effect(() => {
      if (this.approvalCards().length === 0) this.rightPage.closeApprovals();
    });
  }

  protected decide(approvalCard: Waiting, decision: ApprovalDecision): void {
    void this.chats.decide(approvalCard.chat.id, approvalCard.approval.id, decision);
  }

  protected open(approvalCard: Waiting): void {
    this.rightPage.closeApprovals();
    this.chats.open(approvalCard.chat.id);
  }

  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.rightPage.closeApprovals();
  }

  protected move(event: Event, step: number): void {
    const approvalCards = [...this.host.querySelectorAll('gr-approval-card')];
    const at = approvalCards.findIndex((approvalCard) =>
      approvalCard.contains(document.activeElement),
    );
    const next = approvalCards[Math.min(Math.max(at + step, 0), approvalCards.length - 1)];
    if (!next) return;
    event.preventDefault();
    next.querySelector<HTMLElement>('.approve-button')?.focus();
  }
}
