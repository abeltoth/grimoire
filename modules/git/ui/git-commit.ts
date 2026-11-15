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
import type { CommitChat, DiffLine, GitCommitDetail, GitCommitFile } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { DiffView } from '@ui/design-system/diff-view';
import { whenOf } from './git-state';

/**
 * A commit on the Git page: its whole message, who made it and when, the
 * chat whose turn made it, and the files it changed, each expanding as
 * its diff against the first parent.
 */
@Component({
  selector: 'gr-git-commit',
  imports: [DiffView],
  templateUrl: './git-commit.html',
  styleUrl: './git-commit.css',
})
export class GitCommitPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  private readonly chats = inject(ChatList);

  readonly cwd = input.required<string>();
  readonly sha = input.required<string>();
  /** Asks to open another commit, such as a parent. */
  readonly pick = output<string>();
  /** Asks to go back to the overview. */
  readonly back = output<void>();

  /** Undefined until read; null when the repository hasn't got it. */
  protected readonly commit = signal<GitCommitDetail | null | undefined>(undefined);
  /** The file expanded, and its diff once read. */
  protected readonly open = signal<string | null>(null);
  protected readonly diff = signal<readonly DiffLine[] | null>(null);

  constructor() {
    effect(() => {
      const cwd = this.cwd();
      const sha = this.sha();
      untracked(() => {
        this.commit.set(undefined);
        this.open.set(null);
        this.diff.set(null);
        void this.read(cwd, sha);
      });
    });
  }

  protected toggle(file: GitCommitFile): void {
    this.diff.set(null);
    if (this.open() === file.path) {
      this.open.set(null);
      return;
    }
    this.open.set(file.path);
    void this.readDiff(file);
  }

  protected when(at: number): string {
    return whenOf(at, Date.now());
  }

  protected counts(file: GitCommitFile): string {
    return file.added === null ? 'not text' : `+${file.added} −${file.removed}`;
  }

  protected openChat(chat: CommitChat): void {
    void this.chats.openChat({ ...chat, updatedAt: 0 });
  }

  private async read(cwd: string, sha: string): Promise<void> {
    const done = this.pending.add();
    try {
      const commit = await this.bridge.invoke('git.commit', { cwd, sha }).catch(() => null);
      if (sha === this.sha()) this.commit.set(commit ?? null);
    } finally {
      done();
    }
  }

  private async readDiff(file: GitCommitFile): Promise<void> {
    const done = this.pending.add();
    try {
      const request = {
        cwd: this.cwd(),
        sha: this.sha(),
        path: file.path,
        ...(file.from ? { from: file.from } : {}),
      };
      const lines = await this.bridge.invoke('git.commitDiff', request).catch(() => []);
      if (this.open() === file.path) this.diff.set(lines ?? []);
    } finally {
      done();
    }
  }
}
