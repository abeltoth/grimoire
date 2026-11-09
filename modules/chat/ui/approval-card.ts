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
import { Wording } from '@ui/app/core/wording';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import type { Approval, ApprovalDecision } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { askOf, scopeText } from './asks';
import { DiffView } from '@ui/design-system/diff-view';

/**
 * An approval as a card tucked into the page, waiting for you: it
 * shows exactly what the agent wants to do, then Allow once (Enter), Always
 * allow (Shift+Enter) or Deny (Esc, see the chat page). On the right
 * page it says which chat it's from, and Esc turns back instead.
 */
@Component({
  selector: 'gr-approval-card',
  imports: [DiffView, Icon],
  templateUrl: './approval-card.html',
  styleUrl: './approval-card.css',
  host: {
    role: 'group',
    '[attr.aria-labelledby]': 'headId()',
    '[class.from]': 'from() !== undefined',
    '(keydown.shift.enter)': 'decideAlways($event)',
  },
})
export class ApprovalCard {
  readonly approval = input.required<Approval>();
  readonly agentName = input.required<string>();
  /** The chat's folder: where commands run and paths are relative to. */
  readonly cwd = input<string>();
  /** The title of the chat it's from, on the right page. */
  readonly from = input<string>();
  /** Takes the focus when it appears, unless you're writing. */
  readonly autofocus = input(true);
  readonly decided = output<ApprovalDecision>();
  /** Open the chat it's from. */
  readonly opened = output<void>();

  private readonly allow = viewChild.required<ElementRef<HTMLButtonElement>>('allow');

  protected readonly ask = computed(() => askOf(this.approval(), this.cwd()));
  private readonly chats = inject(Chats);
  protected readonly shell = inject(ShellRegistry);
  protected readonly wording = inject(Wording);
  protected readonly folder = computed(() => this.chats.folderName(this.cwd()));
  protected readonly headId = computed(() => `gr-approval-card-${this.approval().id}`);
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
