import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import type { JiraIssueDraft } from '@grimoire/contract';
import type { Chat } from '@ui/app/core/chat';
import { Settings } from '@ui/app/core/settings';
import { Board } from './board';

/**
 * A Jira issue written out to create for a chat, from the agent's
 * proposal when there's one: its summary, description, project and
 * type, each to change. Its project is the agent's, or else the one in
 * the settings, or else the one most of the board's Jira issues are in;
 * its type the agent's, or else the one in the settings.
 */
@Component({
  selector: 'gr-issue-form',
  templateUrl: './issue-form.html',
  styleUrl: './issue-form.css',
})
export class IssueForm {
  readonly chat = input.required<Chat>();
  /** What the agent proposed; a blank issue named after the chat when left out. */
  readonly draft = input<JiraIssueDraft>();
  /** Created, or put away. */
  readonly done = output<void>();

  private readonly board = inject(Board);
  private readonly settings = inject(Settings);

  protected readonly summary = linkedSignal(() => this.draft()?.summary ?? this.chat().title);
  protected readonly description = linkedSignal(() => this.draft()?.description ?? '');
  protected readonly project = linkedSignal(
    () => this.draft()?.project || this.settings.all().jiraProject || this.usualProject(),
  );
  protected readonly issueType = linkedSignal(
    () => this.draft()?.issueType || this.settings.all().jiraIssueType || 'Task',
  );
  protected readonly creating = signal(false);
  /** Why Jira didn't create it, until the next try. */
  protected readonly failed = signal<string | null>(null);
  protected readonly complete = computed(
    () => !!this.summary().trim() && !!this.project().trim() && !!this.issueType().trim(),
  );

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => host.querySelector<HTMLInputElement>('.summary')?.focus());
  }

  protected async create(): Promise<void> {
    if (!this.complete() || this.creating()) return;
    this.creating.set(true);
    this.failed.set(null);
    try {
      const created = await this.board.createIssue(this.chat(), {
        summary: this.summary().trim(),
        description: this.description().trim(),
        project: this.project().trim().toUpperCase(),
        issueType: this.issueType().trim(),
      });
      if (created) this.done.emit();
      else this.failed.set(this.board.failed());
    } finally {
      this.creating.set(false);
    }
  }

  /** The project most of the board's Jira issues are in, by their keys; empty when there are none. */
  private usualProject(): string {
    const counts = new Map<string, number>();
    for (const card of this.board.open()) {
      const project = card.jira?.key.split('-')[0];
      if (project) counts.set(project, (counts.get(project) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }
}
