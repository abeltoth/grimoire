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
import type { DiffLine, GitChange, GitStatus } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { DiffView } from '@ui/design-system/diff-view';

const KINDS: Record<GitChange['kind'], string> = {
  modified: 'modified',
  new: 'new',
  deleted: 'deleted',
  renamed: 'renamed',
  conflicted: 'conflicted',
};

/** What isn't committed yet, each change expanding as its diff against the last commit. */
@Component({
  selector: 'gr-git-changes',
  imports: [DiffView],
  templateUrl: './git-changes.html',
  styleUrl: './git-changes.css',
})
export class GitChanges {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  protected readonly shell = inject(ShellRegistry);

  readonly cwd = input.required<string>();
  readonly status = input.required<GitStatus>();
  /** Asks to go back to the graph. */
  readonly back = output<void>();

  /** The change expanded, and its diff once read. */
  protected readonly open = signal<string | null>(null);
  protected readonly diff = signal<readonly DiffLine[] | null>(null);

  constructor() {
    // The open change is read again with the repository, and closed once it's committed.
    effect(() => {
      const status = this.status();
      const path = this.open();
      const cwd = this.cwd();
      untracked(() => {
        if (!path || !status.changes.some((change) => change.path === path)) {
          if (path) this.open.set(null);
          this.diff.set(null);
          return;
        }
        void this.readDiff(cwd, path);
      });
    });
  }

  protected toggle(change: GitChange): void {
    this.diff.set(null);
    this.open.update((open) => (open === change.path ? null : change.path));
  }

  protected kind(change: GitChange): string {
    return KINDS[change.kind];
  }

  /** The folder a file is in, with a slash; empty at the top. */
  protected folderOf(file: string): string {
    const slash = file.lastIndexOf('/');
    return slash < 0 ? '' : file.slice(0, slash + 1);
  }

  protected nameOf(file: string): string {
    return file.slice(file.lastIndexOf('/') + 1);
  }

  private async readDiff(cwd: string, path: string): Promise<void> {
    const done = this.pending.add();
    try {
      const lines = await this.bridge.invoke('git.diff', { cwd, path }).catch(() => []);
      if (this.open() === path) this.diff.set(lines ?? []);
    } finally {
      done();
    }
  }
}
