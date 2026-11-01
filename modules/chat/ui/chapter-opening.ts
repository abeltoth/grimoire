import { Component, computed, input } from '@angular/core';
import type { ApprovalMode } from '@grimoire/contract';
import { Drawing } from '@ui/design-system/drawing';

/** How the agent works in each permission mode, as the opening page says it. */
const MANNER: Record<ApprovalMode, string> = {
  ask: 'asks before it edits a file or runs a command',
  'accept-edits': 'edits files, but asks before it runs a command',
  plan: 'only reads and plans; it changes nothing',
  'allow-all': 'edits files and runs commands without asking',
};

/**
 * A blank chapter's opening page: when it was begun, who will write it,
 * and where and how the agent will work once you write the first entry.
 */
@Component({
  selector: 'gr-chapter-opening',
  imports: [Drawing],
  templateUrl: './chapter-opening.html',
  styleUrl: './chapter-opening.css',
})
export class ChapterOpening {
  readonly agentName = input.required<string>();
  /** The chapter's folder; missing for your home folder. */
  readonly cwd = input<string>();
  readonly mode = input<ApprovalMode>();
  /** When the blank chapter was opened, in ms since the epoch. */
  readonly begunAt = input.required<number>();
  /** Why the chapter couldn't start. */
  readonly error = input<string>();

  protected readonly begun = computed(() =>
    new Date(this.begunAt()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  );
  protected readonly manner = computed(() => MANNER[this.mode() ?? 'ask']);
}
