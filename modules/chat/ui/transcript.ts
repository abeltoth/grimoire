import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Drawing } from '@ui/design-system/drawing';
import { Icon } from '@ui/design-system/icon';
import { type Chapter, Chats } from '@ui/app/core/chats';
import { Facing } from '@ui/app/shell/facing';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import type { Answer, ApprovalDecision } from '@grimoire/contract';
import { ApprovalSlip } from './approval-slip';
import { Corrections } from '@ui/design-system/corrections';
import { Enclosures } from './enclosures';
import { MarkdownView } from './markdown/markdown-view';
import { parseMarkdown } from './markdown/markdown';
import { Output } from '@ui/design-system/output';
import { QuestionsForm } from './questions-form';
import { SealStub } from './seal-stub';
import { duration } from './duration';
import { type TurnSpent, toRows } from './rows';
import { tokenCount, usesInWords } from '@ui/app/core/tokens';

/**
 * The chapter's transcript: your entries, the agent's replies, its tools
 * as margin notes, and Stop while a turn runs. It keeps the newest text
 * in view unless you scrolled back.
 */
@Component({
  selector: 'gr-transcript',
  imports: [
    Enclosures,
    ApprovalSlip,
    Corrections,
    Drawing,
    Icon,
    MarkdownView,
    NgTemplateOutlet,
    Output,
    QuestionsForm,
    SealStub,
  ],
  templateUrl: './transcript.html',
  styleUrl: './transcript.css',
  host: { role: 'log', 'aria-label': 'Transcript', '(scroll)': 'onScroll()' },
})
export class Transcript {
  private readonly chats = inject(Chats);
  protected readonly shell = inject(ShellRegistry);
  protected readonly facing = inject(Facing);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly chapter = input.required<Chapter>();
  readonly stop = output<void>();

  protected readonly rows = computed(() =>
    toRows(this.chapter().entries, this.chapter().settings.cwd, {
      withdrawn: new Set(this.chapter().withdrawn),
      copied: new Set(this.chapter().copied),
    }),
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
  /** Your entry that began the running turn, and when you wrote it. */
  protected readonly turn = computed(() => {
    if (!this.running()) return undefined;
    const began = this.chapter().entries.filter((entry) => entry.kind === 'user').at(-1);
    return began?.kind === 'user' && began.at !== undefined ? { key: began.id, at: began.at } : undefined;
  });
  private readonly turnKey = computed(() => this.turn()?.key);
  /** The clock the running turn is timed by, ticking each second while it runs. */
  private readonly now = signal(Date.now());
  /** How long the running turn has taken so far. */
  protected readonly elapsed = computed(() => {
    const turn = this.turn();
    return turn ? duration(this.now() - turn.at) : '';
  });
  protected readonly duration = duration;
  protected readonly tokenCount = tokenCount;

  /** What a turn spent, in words, for its title. */
  protected spentTitle(tokens: TurnSpent): string {
    const head = tokens.costly ? 'One of the costliest turns in this chapter: ' : 'This turn: ';
    return `${head}${tokenCount(tokens.weight)} tokens, weighed as the API prices them\n${usesInWords(tokens.uses)}`;
  }
  /** The thinking you're reading and the notes you folded out. */
  private readonly open = signal<ReadonlySet<string>>(new Set());
  /** The entry being undone, until the agent is done. */
  private readonly undoing = signal<string | null>(null);
  private readonly forking = signal(false);

  /** Whether the view follows new text: true unless you scrolled away from the end. */
  private following = true;

  constructor() {
    effect((onCleanup) => {
      if (!this.turnKey()) return;
      this.now.set(Date.now());
      const tick = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(tick));
    });
    afterRenderEffect(() => {
      this.rows();
      this.chapter().error;
      this.chapter().approvals;
      this.open();
      if (this.following) this.element.scrollTop = this.element.scrollHeight;
    });
  }

  protected decide(approvalId: string, decision: ApprovalDecision): void {
    void this.chats.decide(this.chapter().id, approvalId, decision);
  }

  protected answer(approvalId: string, answers: Answer[]): void {
    void this.chats.answer(this.chapter().id, approvalId, answers);
  }

  /** Fork works while the chapter is idle. */
  protected canFork(): boolean {
    return this.chapter().status === 'idle' && !this.forking();
  }

  protected async fork(row: { key: string }): Promise<void> {
    if (!this.canFork()) return;
    this.forking.set(true);
    try {
      await this.chats.fork(this.chapter().id, row.key);
    } finally {
      this.forking.set(false);
    }
  }

  /** Undo shows on entries it can restore files for, and works while the chapter is idle. */
  protected canUndo(): boolean {
    return this.chapter().status === 'idle' && this.undoing() === null;
  }

  protected async undo(row: { key: string }): Promise<void> {
    if (!this.canUndo()) return;
    this.undoing.set(row.key);
    try {
      await this.chats.undo(this.chapter().id, row.key);
    } finally {
      this.undoing.set(null);
    }
  }

  protected onScroll(): void {
    const { scrollTop, clientHeight, scrollHeight } = this.element;
    this.following = scrollTop + clientHeight >= scrollHeight - 24;
  }

  protected isOpen(key: string): boolean {
    return this.open().has(key);
  }

  protected toggle(key: string): void {
    this.open.update((open) => {
      const next = new Set(open);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected time(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
