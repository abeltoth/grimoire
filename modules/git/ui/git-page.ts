import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, PendingTasks, computed, effect, inject, signal, untracked } from '@angular/core';
import type { DiffLine, GitBranch, GitBranches, GitChange } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { ShellRegistry } from '@ui/app/shell/shell-registry';
import { Corrections } from '@ui/design-system/corrections';
import { Icon } from '@ui/design-system/icon';
import { GitState, branchLabel, upstreamDistance } from './git-state';

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
 * The Git page: the open chapter's branch tree, and what isn't committed
 * yet, each change folding out as corrections. It only reads; the agent
 * does the committing.
 */
@Component({
  selector: 'gr-git-page',
  imports: [Corrections, Icon, NgTemplateOutlet],
  templateUrl: './git-page.html',
  styleUrl: './git-page.css',
})
export class GitPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly pending = inject(PendingTasks);
  protected readonly git = inject(GitState);
  protected readonly chats = inject(Chats);
  protected readonly shell = inject(ShellRegistry);

  protected readonly branches = signal<GitBranches | null>(null);
  /** The change folded out, and its corrections once read. */
  protected readonly open = signal<string | null>(null);
  protected readonly diff = signal<readonly DiffLine[] | null>(null);

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

  constructor() {
    const every = setInterval(() => void this.git.read(), READ_EVERY_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(every));

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

  /** When a commit was made: a time today, yesterday, or a date. */
  protected when(at: number): string {
    const date = new Date(at);
    const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
    if (days === 0) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (days === 1) return 'yesterday';
    if (days < 7) return date.toLocaleDateString([], { weekday: 'long' });
    return date.toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    });
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

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
