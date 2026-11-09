import { Component, computed, inject, input } from '@angular/core';
import type { Approval } from '@grimoire/contract';
import { Wording } from '@ui/app/core/wording';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { askOf } from './asks';

/**
 * An approval card that waits on the right page, left in its chat as one line
 * pointing there.
 */
@Component({
  selector: 'gr-approval-stub',
  template: `
    <span class="corner" aria-hidden="true"></span>
    <b>{{ wording.say('¶ Awaiting your seal', 'Waiting for approval') }}</b>
    <code>{{ text() }}</code>
    <button type="button" (click)="rightPage.openApprovals(approval().id)">
      {{ wording.say('seal it on the facing page', 'answer it on the right') }} →
    </button>
  `,
  styleUrl: './approval-stub.css',
})
export class ApprovalStub {
  readonly approval = input.required<Approval>();
  /** The chat's folder: paths are relative to it. */
  readonly cwd = input<string>();

  protected readonly rightPage = inject(RightPageState);
  protected readonly wording = inject(Wording);
  /** What the approval card asks, in one line. */
  protected readonly text = computed(() => {
    const ask = askOf(this.approval(), this.cwd());
    return ask.kind === 'command'
      ? ask.command
      : ask.kind === 'file'
        ? ask.file
        : this.approval().tool;
  });
}
