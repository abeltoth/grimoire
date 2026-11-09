import { DestroyRef, Injectable, PendingTasks, computed, effect, inject, signal, untracked } from '@angular/core';
import type { GitStatus, PullRequest } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import type { Badge } from '@ui/app/shell/shell-registry';

/**
 * The open chat's repository, read live from the background service
 * (ADR-009): again when you open another chat, when a turn ends, and
 * when you come back to the window.
 */
@Injectable({ providedIn: 'root' })
export class GitState {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly chats = inject(Chats);
  private readonly pending = inject(PendingTasks);

  /** The open chat's folder; your home folder until you pick another. */
  readonly cwd = computed(() => this.chats.current()?.settings.cwd ?? (this.chats.folders().home || undefined));
  /** Null outside a repository; undefined until it's first read. */
  readonly status = signal<GitStatus | null | undefined>(undefined);
  /** The pull request for the branch checked out, if it has one. */
  readonly pullRequest = signal<PullRequest | null>(null);

  /** Whether the agent is between turns, when files stop changing under it. */
  private readonly settled = computed(() => {
    const status = this.chats.current()?.status;
    return status !== 'thinking' && status !== 'writing';
  });
  /** Which read is the latest, so an earlier one answering late is dropped. */
  private reads = 0;

  constructor() {
    effect(() => {
      this.cwd();
      if (this.settled()) untracked(() => void this.read());
    });
    const onFocus = () => void this.read();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('focus', onFocus));
  }

  /** Reads the repository again. */
  async read(): Promise<void> {
    const read = ++this.reads;
    const cwd = this.cwd();
    const done = this.pending.add();
    try {
      const status = cwd ? await this.bridge.invoke('git.status', { cwd }).catch(() => null) : null;
      if (read !== this.reads) return;
      this.status.set(status ?? null);
      const pullRequest =
        cwd && status?.branch
          ? await this.bridge.invoke('git.pullRequest', { cwd }).catch(() => null)
          : null;
      if (read === this.reads) this.pullRequest.set(pullRequest ?? null);
    } finally {
      done();
    }
  }
}

/** What the page footer says about the repository on hover. */
export function statusDetail(status: GitStatus): string {
  const parts: string[] = [];
  const changes = status.changes.length;
  parts.push(
    changes === 0 ? 'Nothing uncommitted' : `${changes} ${changes === 1 ? 'file' : 'files'} not committed`,
  );
  if (status.upstream) parts.push(upstreamDistance(status.upstream));
  return parts.join(' · ');
}

/** How far the branch is from its upstream, such as "2 ahead, 1 behind origin/main". */
export function upstreamDistance({ name, ahead, behind }: NonNullable<GitStatus['upstream']>): string {
  if (!ahead && !behind) return `even with ${name}`;
  if (!behind) return `${ahead} ahead of ${name}`;
  return `${ahead ? `${ahead} ahead, ` : ''}${behind} behind ${name}`;
}

/** The branch as the page footer names it. */
export function branchLabel(status: GitStatus): string {
  if (status.branch) return status.branch;
  return status.head ? `detached at ${status.head}` : 'no commits yet';
}

/** The pull request's badges: its review, and its checks once they've run or are running. */
export function badgesOf(pr: PullRequest): Omit<Badge, 'order' | 'open'>[] {
  const review =
    pr.state === 'merged'
      ? 'merged'
      : pr.state === 'closed'
        ? 'closed'
        : pr.state === 'draft'
          ? 'draft'
          : pr.review === 'approved'
            ? 'approved'
            : pr.review === 'changes-requested'
              ? 'changes requested'
              : 'in review';
  const badges: ReturnType<typeof badgesOf> = [
    {
      id: 'git.pullRequest',
      label: `PR #${pr.number}: ${review}`,
      ...(pr.review === 'changes-requested' && pr.state === 'open'
        ? { tone: 'alert' as const }
        : pr.state === 'open'
          ? {}
          : { tone: 'quiet' as const }),
      detail: pr.title,
    },
  ];
  const { passed, failed, pending } = pr.checks;
  const total = passed + failed + pending;
  if (total && pr.state !== 'merged' && pr.state !== 'closed') {
    const label = failed
      ? `CI: ${failed} ${failed === 1 ? 'check' : 'checks'} failing`
      : pending
        ? `CI: ${pending} ${pending === 1 ? 'check' : 'checks'} running`
        : 'CI: passing';
    const counts = [
      passed && `${passed} passed`,
      failed && `${failed} failed`,
      pending && `${pending} running`,
    ].filter(Boolean);
    badges.push({
      id: 'git.checks',
      label,
      tone: failed ? 'alert' : 'quiet',
      detail: counts.join(', '),
    });
  }
  return badges;
}
