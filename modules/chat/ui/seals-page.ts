import { Component, ElementRef, computed, effect, inject, input } from '@angular/core';
import type { Approval, ApprovalDecision } from '@grimoire/contract';
import { type Chapter, Chats } from '@ui/app/core/chats';
import { Wording } from '@ui/app/core/wording';
import { Facing } from '@ui/app/shell/facing';
import { RunningFoot } from '@ui/app/shell/running-foot';
import { RunningHead } from '@ui/app/shell/running-head';
import { ApprovalSlip } from './approval-slip';

interface Slip {
  chapter: Chapter;
  approval: Approval;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The facing page turned to every slip awaiting your seal, from all open
 * chapters, oldest first. Sealing one here answers it in its chapter. ↑ and
 * ↓ move between slips; Esc turns back, and so does sealing the last one.
 */
@Component({
  selector: 'gr-seals-page',
  imports: [ApprovalSlip, RunningFoot, RunningHead],
  templateUrl: './seals-page.html',
  styleUrl: './seals-page.css',
  host: {
    '(document:keydown.escape)': 'back($event)',
    '(keydown.arrowdown)': 'move($event, 1)',
    '(keydown.arrowup)': 'move($event, -1)',
  },
})
export class SealsPage {
  /** The label of the page it turns back to. */
  readonly backTo = input('facing page');

  protected readonly chats = inject(Chats);
  protected readonly facing = inject(Facing);
  protected readonly wording = inject(Wording);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly slips = computed<Slip[]>(() =>
    this.chats
      .all()
      .flatMap((chapter) =>
        // Questions wait for answers in their chapter, not for a seal.
        chapter.approvals.filter((a) => !a.questions).map((approval) => ({ chapter, approval })),
      )
      .sort((a, b) => (a.approval.at ?? 0) - (b.approval.at ?? 0)),
  );
  protected readonly summary = computed(() => {
    const slips = this.slips();
    const chapters = new Set(slips.map((slip) => slip.chapter.id)).size;
    const [slip, chapter] = this.wording.plain() ? ['request', 'chat'] : ['slip', 'chapter'];
    return `${plural(slips.length, slip)} from ${plural(chapters, chapter)}, oldest first`;
  });
  /** The slip you start on. */
  protected readonly first = computed(() => {
    const asked = this.facing.sealFirst();
    const slips = this.slips();
    return slips.some((slip) => slip.approval.id === asked) ? asked : slips[0]?.approval.id;
  });

  constructor() {
    effect(() => {
      if (this.slips().length === 0) this.facing.closeSeals();
    });
  }

  protected decide(slip: Slip, decision: ApprovalDecision): void {
    void this.chats.decide(slip.chapter.id, slip.approval.id, decision);
  }

  protected open(slip: Slip): void {
    this.facing.closeSeals();
    this.chats.open(slip.chapter.id);
  }

  protected back(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    this.facing.closeSeals();
  }

  protected move(event: Event, step: number): void {
    const slips = [...this.host.querySelectorAll('gr-approval-slip')];
    const at = slips.findIndex((slip) => slip.contains(document.activeElement));
    const next = slips[Math.min(Math.max(at + step, 0), slips.length - 1)];
    if (!next) return;
    event.preventDefault();
    next.querySelector<HTMLElement>('.seal-button')?.focus();
  }
}
