import {
  Component,
  PendingTasks,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { CommitChat, GitCommit } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { whenOf } from './git-state';

/** How many commits are read at a time. */
const PAGE = 50;

/**
 * A branch's history, newest first, a page at a time: each commit opens
 * on its own, the ones not on the trunk are marked, and the chat that
 * made one opens from it.
 */
@Component({
  selector: 'gr-git-history',
  templateUrl: './git-history.html',
  styleUrl: './git-history.css',
})
export class GitHistory {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly chats = inject(ChatList);

  readonly cwd = input.required<string>();
  /** The branch, or commit, the history is read from. */
  readonly ref = input.required<string>();
  /** The commit checked out: when it moves, the history is read again. */
  readonly head = input<string | null>(null);
  /** Asks to open a commit, by its sha. */
  readonly pick = output<string>();

  /** Null until the first page is read. */
  protected readonly commits = signal<GitCommit[] | null>(null);
  protected readonly more = signal(false);
  protected readonly reading = signal(false);
  /** Which read is the latest, so an earlier one answering late is dropped. */
  private reads = 0;

  constructor() {
    effect(() => {
      const cwd = this.cwd();
      const ref = this.ref();
      this.head();
      untracked(() => {
        this.commits.set(null);
        void this.read(cwd, ref, 0);
      });
    });
  }

  protected showOlder(): void {
    void this.read(this.cwd(), this.ref(), this.commits()?.length ?? 0);
  }

  protected when(at: number): string {
    return whenOf(at, Date.now());
  }

  protected openChat(chat: CommitChat): void {
    void this.chats.openChat({ ...chat, updatedAt: 0 });
  }

  private async read(cwd: string, ref: string, skip: number): Promise<void> {
    const read = ++this.reads;
    const done = this.pending.add();
    this.reading.set(true);
    try {
      const page = await this.bridge
        .invoke('git.log', { cwd, ref, skip, limit: PAGE })
        .catch(() => null);
      if (read !== this.reads) return;
      const commits = page?.commits ?? [];
      this.commits.update((before) => (skip ? [...(before ?? []), ...commits] : commits));
      this.more.set(page?.more ?? false);
    } finally {
      if (read === this.reads) this.reading.set(false);
      done();
    }
  }
}
