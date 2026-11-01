import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Drawing } from '@ui/design-system/drawing';
import { Icon } from '@ui/design-system/icon';
import { type Chapter, Chats } from '@ui/app/core/chats';
import type { Answer, ApprovalDecision } from '@grimoire/contract';
import { ApprovalSlip } from './approval-slip';
import { MarkdownView } from './markdown/markdown-view';
import { parseMarkdown } from './markdown/markdown';
import { QuestionsForm } from './questions-form';
import { toRows } from './rows';

/**
 * The chapter's transcript: your entries, the agent's replies, its tools
 * as margin notes, and Stop while a turn runs. It keeps the newest text
 * in view unless you scrolled back.
 */
@Component({
  selector: 'gr-transcript',
  imports: [ApprovalSlip, Drawing, Icon, MarkdownView, NgTemplateOutlet, QuestionsForm],
  templateUrl: './transcript.html',
  styleUrl: './transcript.css',
  host: { role: 'log', 'aria-label': 'Transcript', '(scroll)': 'onScroll()' },
})
export class Transcript {
  private readonly chats = inject(Chats);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly chapter = input.required<Chapter>();
  readonly stop = output<void>();

  protected readonly rows = computed(() =>
    toRows(this.chapter().entries, this.chapter().settings.cwd),
  );
  protected readonly agentName = computed(() => this.chats.agentName(this.chapter().agent));
  protected readonly running = computed(() =>
    ['thinking', 'writing', 'waiting'].includes(this.chapter().status),
  );
  protected readonly writing = computed(() => this.chapter().status === 'writing');
  /** Code listings are numbered through the chapter: each reply's first number. */
  protected readonly listingStarts = computed(() => {
    const starts = new Map<string, number>();
    const rows = this.rows();
    let next = 1;
    rows.forEach((row, i) => {
      if (row.kind !== 'reply') return;
      starts.set(row.key, next);
      next += parseMarkdown(row.text, i === rows.length - 1 && this.writing()).listings;
    });
    return starts;
  });
  /** Stop shows while the agent works; while it waits for you, you answer instead. */
  protected readonly stoppable = computed(() =>
    ['thinking', 'writing'].includes(this.chapter().status),
  );
  protected readonly endsInReply = computed(() => this.rows().at(-1)?.kind === 'reply');
  private readonly openThinking = signal<ReadonlySet<string>>(new Set());

  /** Whether the view follows new text: true unless you scrolled away from the end. */
  private following = true;

  constructor() {
    afterRenderEffect(() => {
      this.rows();
      this.chapter().error;
      this.chapter().approvals;
      if (this.following) this.element.scrollTop = this.element.scrollHeight;
    });
  }

  protected decide(approvalId: string, decision: ApprovalDecision): void {
    void this.chats.decide(this.chapter().id, approvalId, decision);
  }

  protected answer(approvalId: string, answers: Answer[]): void {
    void this.chats.answer(this.chapter().id, approvalId, answers);
  }

  protected onScroll(): void {
    const { scrollTop, clientHeight, scrollHeight } = this.element;
    this.following = scrollTop + clientHeight >= scrollHeight - 24;
  }

  protected isOpen(key: string): boolean {
    return this.openThinking().has(key);
  }

  protected toggleThinking(key: string): void {
    this.openThinking.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected time(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
