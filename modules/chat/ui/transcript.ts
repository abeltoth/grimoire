import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Drawing } from '@ui/design-system/drawing';
import { Icon } from '@ui/design-system/icon';
import { type Chat, Chats } from '@ui/app/core/chats';
import { RightPageState } from '@ui/app/shell/right-page-state';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import type { Answer, ApprovalDecision, HookRun } from '@grimoire/contract';
import { ApprovalCard } from './approval-card';
import { DiffView } from '@ui/design-system/diff-view';
import { Attachments } from './attachments';
import { MarkdownView } from './markdown/markdown-view';
import { parseMarkdown } from './markdown/markdown';
import { Output } from '@ui/design-system/output';
import { QuestionsForm } from './questions-form';
import { ApprovalStub } from './approval-stub';
import { duration } from './duration';
import { Subagents } from './subagents';
import { type Note, type TurnSpent, toRows } from './rows';
import { hookOutcome, hookTook, hookWhen, hooksRan } from './hook-log';
import { tokenCount, usesInWords } from '@ui/app/core/tokens';
import { Wording } from '@ui/app/core/wording';

/** The Kanban board's page tab, which a note for a task the agent added there turns to. */
const BOARD = 'kanban';

/**
 * The chat's transcript: your messages, the agent's replies, its tools
 * as tool notes, and Stop while a turn runs. It keeps the newest text
 * in view unless you scrolled back. A note for a task handed to a subagent
 * turns the right page to what the subagent did, where there's one; one for
 * a task the agent added to the Kanban board, to the board.
 *
 * As a subagent's run, it only reads: its task is signed `askedBy`, its
 * replies `by`, and it has no Stop, Undo or Fork. What's put inside it
 * follows the last row.
 */
@Component({
  selector: 'gr-transcript',
  imports: [
    Attachments,
    ApprovalCard,
    DiffView,
    Drawing,
    Icon,
    MarkdownView,
    NgTemplateOutlet,
    Output,
    QuestionsForm,
    ApprovalStub,
  ],
  templateUrl: './transcript.html',
  styleUrl: './transcript.css',
  host: { role: 'log', 'aria-label': 'Transcript', '(scroll)': 'onScroll()' },
})
export class Transcript {
  private readonly chats = inject(Chats);
  private readonly subagents = inject(Subagents);
  protected readonly shell = inject(ShellRegistry);
  protected readonly rightPage = inject(RightPageState);
  protected readonly wording = inject(Wording);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly chat = input.required<Chat>();
  /** A subagent's run, which only reads. */
  readonly subagent = input(false, { transform: booleanAttribute });
  /** Who signs the replies; the chat's agent when unset. */
  readonly by = input<string>();
  /** Who signs the entries that ask; you when unset. */
  readonly askedBy = input<string>();
  readonly stop = output<void>();

  protected readonly rows = computed(() =>
    toRows(this.chat().entries, this.chat().settings.cwd, {
      withdrawn: new Set(this.chat().withdrawn),
      copied: new Set(this.chat().copied),
    }),
  );
  protected readonly agentName = computed(
    () => this.by() ?? this.chats.agentName(this.chat().agent),
  );
  protected readonly running = computed(() =>
    ['thinking', 'writing', 'waiting'].includes(this.chat().status),
  );
  protected readonly writing = computed(() => this.chat().status === 'writing');
  /** Code listings are numbered through the chat: each reply's first number. */
  protected readonly listingStarts = computed(() => {
    const starts = new Map<string, number>();
    const rows = this.rows();
    let next = 1;
    for (const row of rows) {
      if (row.kind !== 'reply') continue;
      starts.set(row.key, next);
      next += parseMarkdown(row.text, row.key === this.lastKey() && this.writing()).listings;
    }
    return starts;
  });
  /** Stop shows while the agent works; while it waits for you, you answer instead. */
  protected readonly stoppable = computed(
    () => !this.subagent() && ['thinking', 'writing'].includes(this.chat().status),
  );
  /** The row the running turn writes on: the last, but for the closing line its hooks show on. */
  private readonly lastRow = computed(() => {
    const rows = this.rows();
    return rows.at(-1)?.kind === 'spent' ? rows.at(-2) : rows.at(-1);
  });
  protected readonly lastKey = computed(() => this.lastRow()?.key);
  protected readonly endsInReply = computed(() => this.lastRow()?.kind === 'reply');
  /** Your message that began the running turn, and when you wrote it. */
  protected readonly turn = computed(() => {
    if (!this.running()) return undefined;
    const began = this.chat()
      .entries.filter((entry) => entry.kind === 'user')
      .at(-1);
    return began?.kind === 'user' && began.at !== undefined
      ? { key: began.id, at: began.at }
      : undefined;
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
  protected readonly hooksRan = hooksRan;
  protected readonly hookTook = hookTook;
  protected readonly hookWhen = (run: HookRun) => hookWhen(run, this.wording.say);
  protected readonly hookOutcome = (run: HookRun) => hookOutcome(run, this.wording.say);

  /** What a turn spent, in words, for its title. */
  protected spentTitle(tokens: TurnSpent): string {
    const head = tokens.costly
      ? this.wording.say(
          'One of the costliest turns in this chapter: ',
          'One of the costliest turns in this chat: ',
        )
      : 'This turn: ';
    return `${head}${tokenCount(tokens.weight)} tokens, weighed as the API prices them\n${usesInWords(tokens.uses)}`;
  }
  /** The thinking you're reading, and the runs of notes and hooks you expanded. */
  private readonly open = signal<ReadonlySet<string>>(new Set());
  /** The note whose details you expanded: one at a time, so opening another closes it. */
  private readonly expandedNote = signal<string | null>(null);
  /** The message being undone, until the agent is done. */
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
      void this.chat().error;
      void this.chat().approvals;
      void this.chat().followUps;
      this.open();
      this.expandedNote();
      if (this.following) this.element.scrollTop = this.element.scrollHeight;
    });
  }

  protected decide(approvalId: string, decision: ApprovalDecision): void {
    void this.chats.decide(this.chat().id, approvalId, decision);
  }

  protected answer(approvalId: string, answers: Answer[]): void {
    void this.chats.answer(this.chat().id, approvalId, answers);
  }

  /** Fork works while the chat is idle. */
  protected canFork(): boolean {
    return this.chat().status === 'idle' && !this.forking();
  }

  protected async fork(row: { key: string }): Promise<void> {
    if (!this.canFork()) return;
    this.forking.set(true);
    try {
      await this.chats.fork(this.chat().id, row.key);
    } finally {
      this.forking.set(false);
    }
  }

  /** Undo shows on entries it can restore files for, and works while the chat is idle. */
  protected canUndo(): boolean {
    return this.chat().status === 'idle' && this.undoing() === null;
  }

  protected async undo(row: { key: string }): Promise<void> {
    if (!this.canUndo()) return;
    this.undoing.set(row.key);
    try {
      await this.chats.undo(this.chat().id, row.key);
    } finally {
      this.undoing.set(null);
    }
  }

  protected onScroll(): void {
    const { scrollTop, clientHeight, scrollHeight } = this.element;
    this.following = scrollTop + clientHeight >= scrollHeight - 24;
  }

  /** Whether a note turns the right page to its subagent's run, rather than expanding. */
  protected showsSubagent(note: Note): boolean {
    return !!note.subagent && this.subagents.canShow();
  }

  /**
   * Whether a note turns the right page to the Kanban board, rather than
   * expanding: one for a task the agent added there, where there's one.
   */
  protected showsBoard(note: Note): boolean {
    return (
      note.did === 'added' && !note.running && !note.failed && !!this.shell.pageTabs.get(BOARD)
    );
  }

  /** Whether a note turns the right page, to its subagent's run or to the board. */
  protected turnsPage(note: Note): boolean {
    return this.showsSubagent(note) || this.showsBoard(note);
  }

  protected press(note: Note): void {
    if (this.showsSubagent(note)) this.subagents.show(this.chat().id, note.subagent!);
    else if (this.showsBoard(note)) this.rightPage.openPageTab(BOARD);
    else if (note.details) this.expandedNote.update((key) => (key === note.key ? null : note.key));
  }

  protected isExpanded(note: Note): boolean {
    return this.expandedNote() === note.key;
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
