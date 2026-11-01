import { Component, computed, inject, viewChild } from '@angular/core';
import type { ApprovalMode } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { Chats } from '@ui/app/core/chats';
import { RunningFoot } from '@ui/app/shell/running-foot';
import { RunningHead } from '@ui/app/shell/running-head';
import { StatusIndicators } from '@ui/app/shell/status-indicators';
import { ChapterOpening } from './chapter-opening';
import { Composer } from './composer';
import { Transcript } from './transcript';

const MODE_LABELS: Record<ApprovalMode, string> = {
  ask: 'Ask first',
  'accept-edits': 'Accept edits',
  plan: 'Plan only',
  'allow-all': 'Allow all',
};

/**
 * The open chapter on the left page: its running head with the chat's
 * settings, the transcript (or a blank chapter's opening page), the next
 * page to write on, and the running foot. Esc denies the approval awaiting your seal, or else stops the
 * running turn and puts the queued messages back on the next page.
 */
@Component({
  selector: 'gr-chapter-page',
  imports: [
    ChapterOpening,
    Composer,
    Icon,
    RunningFoot,
    RunningHead,
    StatusIndicators,
    Transcript,
  ],
  templateUrl: './chapter-page.html',
  styleUrl: './chapter-page.css',
  host: { '(document:keydown.escape)': 'stop()' },
})
export class ChapterPage {
  protected readonly chats = inject(Chats);
  protected readonly chapter = this.chats.current;
  private readonly composer = viewChild(Composer);
  private readonly running = computed(() =>
    ['thinking', 'writing', 'waiting'].includes(this.chapter()?.status ?? ''),
  );

  protected modeLabel(mode: ApprovalMode | undefined): string {
    return MODE_LABELS[mode ?? 'ask'];
  }

  protected stop(): void {
    const chapter = this.chapter();
    if (!chapter) return;
    const seal = chapter.approvals.find((approval) => !approval.questions);
    if (seal) void this.chats.decide(chapter.id, seal.id, 'deny');
    else if (this.running())
      void this.chats.interrupt(chapter.id).then((withdrawn) => {
        if (this.chapter()?.id === chapter.id)
          this.composer()?.takeBack(withdrawn.map((queued) => queued.text));
      });
  }
}
