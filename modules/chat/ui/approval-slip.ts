import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import type { Approval, ApprovalDecision } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { askOf, scopeText } from './asks';
import { Corrections } from './corrections';

/**
 * An approval as a slip tucked into the page, waiting for your seal: it
 * shows exactly what the agent wants to do, then Allow once (Enter), Always
 * allow (Shift+Enter) or Deny (Esc, see the chapter page).
 */
@Component({
  selector: 'gr-approval-slip',
  imports: [Corrections, Icon],
  templateUrl: './approval-slip.html',
  styleUrl: './approval-slip.css',
  host: {
    role: 'group',
    '[attr.aria-labelledby]': 'headId()',
    '(keydown.shift.enter)': 'decideAlways($event)',
  },
})
export class ApprovalSlip {
  readonly approval = input.required<Approval>();
  readonly agentName = input.required<string>();
  /** The chapter's folder: where commands run and paths are relative to. */
  readonly cwd = input<string>();
  readonly decided = output<ApprovalDecision>();

  private readonly allow = viewChild.required<ElementRef<HTMLButtonElement>>('allow');

  protected readonly ask = computed(() => askOf(this.approval(), this.cwd()));
  protected readonly headId = computed(() => `gr-slip-${this.approval().id}`);
  protected readonly scopeText = scopeText;

  constructor() {
    // Ready for Enter, unless you're writing somewhere.
    afterNextRender(() => {
      const active = document.activeElement;
      const writing =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (!writing) this.allow().nativeElement.focus();
    });
  }

  protected decideAlways(event: Event): void {
    if (!this.approval().alwaysAllow) return;
    event.preventDefault();
    this.decided.emit('allow-always');
  }
}
