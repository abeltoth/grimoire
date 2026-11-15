import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { GitChanges } from './git-changes';
import { GitCommitPage } from './git-commit';
import { GitGraph } from './git-graph';
import { GitState, branchLabel, upstreamDistance } from './git-state';

/** How often the page reads the repository again while it's open. */
const READ_EVERY_MS = 10_000;

/**
 * The Git page: the open chat's repository, and its history as a graph of
 * every branch, the changes not committed yet on top. A commit or the
 * changes open in its place, the graph kept as it was for coming back.
 * It only reads; the agent does the committing.
 */
@Component({
  selector: 'gr-git-page',
  imports: [GitChanges, GitCommitPage, GitGraph],
  templateUrl: './git-page.html',
  styleUrl: './git-page.css',
})
export class GitPage {
  protected readonly git = inject(GitState);
  protected readonly catalog = inject(AgentCatalog);

  /** What shows in the graph's place: the changes, or a commit by its sha. */
  protected readonly view = signal<'changes' | { sha: string } | null>(null);

  protected readonly branchLabel = computed(() => {
    const status = this.git.status();
    return status ? branchLabel(status) : '';
  });
  protected readonly upstreamDistance = upstreamDistance;

  constructor() {
    const every = setInterval(() => void this.git.read(), READ_EVERY_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(every));
    // Another folder starts the page over.
    effect(() => {
      this.git.cwd();
      untracked(() => this.view.set(null));
    });
  }

  protected openCommit(sha: string): void {
    this.view.set({ sha });
  }
}
