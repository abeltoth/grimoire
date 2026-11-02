import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Chats } from '@ui/app/core/chats';
import type { Approval, ApprovalDecision } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { askOf, scopeText } from './asks';
import { Corrections } from '@ui/design-system/corrections';

/**
 * An approval as a slip tucked into the page, waiting for your seal: it
 * shows exactly what the agent wants to do, then Allow once (Enter), Always
 * allow (Shift+Enter) or Deny (Esc, see the chapter page). On the facing
 * page it says which chapter it's from, and Esc turns back instead.
 */
@Component({
  selector: 'gr-approval-slip',
  imports: [Corrections, Icon],
  templateUrl: './approval-slip.html',
  styleUrl: './approval-slip.css',
  host: {
    role: 'group',
    '[attr.aria-labelledby]': 'headId()',
    '[class.from]': 'from() !== undefined',
    '(keydown.shift.enter)': 'decideAlways($event)',
  },
})
export class ApprovalSlip {
  readonly approval = input.required<Approval>();
  readonly agentName = input.required<string>();
  /** The chapter's folder: where commands run and paths are relative to. */
  readonly cwd = input<string>();
  /** The title of the chapter it's from, on the facing page. */
  readonly from = input<string>();
  /** Takes the focus when it appears, unless you're writing. */
  readonly autofocus = input(true);
  readonly decided = output<ApprovalDecision>();
  /** Open the chapter it's from. */
  readonly opened = output<void>();

  private readonly allow = viewChild.required<ElementRef<HTMLButtonElement>>('allow');

  protected readonly ask = computed(() => askOf(this.approval(), this.cwd()));
  private readonly chats = inject(Chats);
  protected readonly folder = computed(() => this.chats.folderName(this.cwd()));
  protected readonly headId = computed(() => `gr-slip-${this.approval().id}`);
  protected readonly scopeText = scopeText;

  constructor() {
    // Ready for Enter, unless you're writing somewhere.
    afterNextRender(() => {
      if (!this.autofocus()) return;
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
