import { Component, computed, inject, input } from '@angular/core';
import type { Approval } from '@grimoire/contract';
import { Wording } from '@ui/app/core/wording';
import { Facing } from '@ui/app/shell/facing';
import { askOf } from './asks';

/**
 * A slip that waits on the facing page, left in its chapter as one line
 * pointing there.
 */
@Component({
  selector: 'gr-seal-stub',
  template: `
    <span class="corner" aria-hidden="true"></span>
    <b>{{ wording.say('¶ Awaiting your seal', 'Waiting for approval') }}</b>
    <code>{{ text() }}</code>
    <button type="button" (click)="facing.openSeals(approval().id)">
      {{ wording.say('seal it on the facing page', 'answer it on the right') }} →
    </button>
  `,
  styleUrl: './seal-stub.css',
})
export class SealStub {
  readonly approval = input.required<Approval>();
  /** The chapter's folder: paths are relative to it. */
  readonly cwd = input<string>();

  protected readonly facing = inject(Facing);
  protected readonly wording = inject(Wording);
  /** What the slip asks, in one line. */
  protected readonly text = computed(() => {
    const ask = askOf(this.approval(), this.cwd());
    return ask.kind === 'command' ? ask.command : ask.kind === 'file' ? ask.file : this.approval().tool;
  });
}
