import { Component, computed, inject, input } from '@angular/core';
import type { Approval } from '@grimoire/contract';
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
    <b>¶ Awaiting your seal</b>
    <code>{{ text() }}</code>
    <button type="button" (click)="facing.openSeals(approval().id)">
      seal it on the facing page →
    </button>
  `,
  styleUrl: './seal-stub.css',
})
export class SealStub {
  readonly approval = input.required<Approval>();
  /** The chapter's folder: paths are relative to it. */
  readonly cwd = input<string>();

  protected readonly facing = inject(Facing);
  /** What the slip asks, in one line. */
  protected readonly text = computed(() => {
    const ask = askOf(this.approval(), this.cwd());
    return ask.kind === 'command' ? ask.command : ask.kind === 'file' ? ask.file : this.approval().tool;
  });
}
