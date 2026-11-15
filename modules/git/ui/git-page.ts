import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  PendingTasks,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { DiffLine, GitBranch, GitBranches, GitChange } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { DiffView } from '@ui/design-system/diff-view';
import { Icon } from '@ui/design-system/icon';
import { GitCommitPage } from './git-commit';
import { GitHistory } from './git-history';
import { GitState, branchLabel, upstreamDistance, whenOf } from './git-state';

/** How often the page reads the repository again while it's open. */
const READ_EVERY_MS = 10_000;

const KINDS: Record<GitChange['kind'], string> = {
  modified: 'modified',
  new: 'new',
  deleted: 'deleted',
  renamed: 'renamed',
  conflicted: 'conflicted',
};

/**
 * The Git page: the open chat's branch tree, what isn't committed yet,
 * each change expanding as a diff, and a branch's history, each commit
 * opening on its own. It only reads; the agent does the committing.
 */
@Component({
  selector: 'gr-git-page',
  imports: [DiffView, GitCommitPage, GitHistory, Icon, NgTemplateOutlet],
  templateUrl: './git-page.html',
  styleUrl: './git-page.css',
})
export class GitPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  protected readonly git = inject(GitState);
  protected readonly catalog = inject(AgentCatalog);
  protected readonly shell = inject(ShellRegistry);

  protected readonly branches = signal<GitBranches | null>(null);
  /** The change expanded, and its diff once read. */
  protected readonly open = signal<string | null>(null);
  protected readonly diff = signal<readonly DiffLine[] | null>(null);
  /** The branch whose history shows, when you picked one. */
  protected readonly selected = signal<string | null>(null);
  /** The commit shown instead of the overview. */
  protected readonly commit = signal<string | null>(null);

  protected readonly branchLabel = computed(() => {
    const status = this.git.status();
    return status ? branchLabel(status) : '';
  });
  protected readonly trunk = computed(() => {
    const { trunk, branches = [] } = this.branches() ?? {};
    return branches.find((branch) => branch.name === trunk);
  });
  /** The branches grown from the trunk, or all of them when there's none. */
  protected readonly grown = computed(() => {
    const trunk = this.trunk();
    return (this.branches()?.branches ?? []).filter((branch) => branch !== trunk);
  });
  /** Whose history shows: the branch picked, else the one checked out, else the trunk. */
  protected readonly historyRef = computed(() => {
    const names = this.branches()?.branches.map((branch) => branch.name);
    const selected = this.selected();
    if (selected && names?.includes(selected)) return selected;
    return this.git.status()?.branch ?? this.trunk()?.name ?? 'HEAD';
  });

  constructor() {
    const every = setInterval(() => void this.git.read(), READ_EVERY_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(every));

    // Another folder starts the page over.
    effect(() => {
      this.git.cwd();
      untracked(() => {
        this.selected.set(null);
        this.commit.set(null);
      });
    });
    // The branches and the open change are read again with the repository.
    effect(() => {
      const status = this.git.status();
      const cwd = this.git.cwd();
      untracked(() => void this.readBranches(status ? cwd : undefined));
    });
    effect(() => {
      const status = this.git.status();
      const path = this.open();
      const cwd = this.git.cwd();
      untracked(() => {
        if (!path || !cwd || !status?.changes.some((change) => change.path === path)) {
          if (path) this.open.set(null);
          this.diff.set(null);
          return;
        }
        void this.readDiff(cwd, path);
      });
    });
  }

  protected readonly upstreamDistance = upstreamDistance;

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

  /** How far a branch is from the trunk, such as "2 ahead, 1 behind". */
  protected distance(branch: GitBranch): string {
    const counts = [
      branch.ahead && `${branch.ahead} ahead`,
      branch.behind && `${branch.behind} behind`,
    ].filter(Boolean);
    return counts.length ? counts.join(', ') : 'even';
  }

  protected when(at: number): string {
    return whenOf(at, Date.now());
  }

  private async readBranches(cwd: string | undefined): Promise<void> {
    if (!cwd) {
      this.branches.set(null);
      return;
    }
    const done = this.pending.add();
    try {
      const branches = await this.bridge.invoke('git.branches', { cwd }).catch(() => null);
      if (cwd === this.git.cwd()) this.branches.set(branches ?? null);
    } finally {
      done();
    }
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
